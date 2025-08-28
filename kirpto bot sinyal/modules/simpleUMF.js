/**
 * Simple UMF - Basit Çalışan Versiyon
 * 
 * Binance verisini normalize edip yayınlar
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');

// Global pub-sub bus
const bus = new EventEmitter();
bus.setMaxListeners(100);

class SimpleUMF extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            baseUrl: 'https://api.binance.com',
            wsBaseUrl: 'wss://stream.binance.com:9443',
            symbols: ['BTCUSDT'],
            streams: ['kline_1m', 'trade'],
            debug: true,
            ...config
        };
        
        this.activeStreams = new Map();
        this.stats = {
            totalEvents: 0,
            errors: 0,
            startTime: Date.now()
        };
        
        this.driftMs = 0;
    }

    /**
     * Subscribe to events - EventEmitter wrapper
     */
    subscribe(topic, callback) {
        bus.on(topic, callback);
    }

    /**
     * Publish events
     */
    publish(topic, data) {
        const message = {
            ...data,
            timestamp: Date.now(),
            source: 'binance',
            driftMs: this.driftMs
        };
        
        bus.emit(topic, message);
        
        if (this.config.debug) {
            console.log(`📡 ${topic}:`, JSON.stringify(message).substring(0, 100) + '...');
        }
        
        this.stats.totalEvents++;
    }

    /**
     * Time sync
     */
    async timeSync() {
        try {
            const start = Date.now();
            const response = await axios.get(`${this.config.baseUrl}/api/v3/time`);
            const end = Date.now();
            
            const serverTime = response.data.serverTime;
            this.driftMs = serverTime - (start + (end - start) / 2);
            
            console.log(`🕐 Time sync: ${this.driftMs}ms drift`);
            
            this.publish('umf.clock', {
                serverTime,
                localTime: Date.now(),
                driftMs: this.driftMs
            });
            
            return this.driftMs;
        } catch (error) {
            console.error('❌ Time sync failed:', error.message);
            throw error;
        }
    }

    /**
     * Normalize kline data
     */
    normalizeKline(rawData) {
        const k = rawData.k;
        
        return {
            kind: 'kline',
            symbol: k.s,
            interval: k.i,
            openTime: parseInt(k.t),
            closeTime: parseInt(k.T),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            quoteVolume: parseFloat(k.q),
            trades: parseInt(k.n),
            closed: k.x,
            eventTime: rawData.E,
            validated: true
        };
    }

    /**
     * Normalize trade data
     */
    normalizeTrade(rawData) {
        return {
            kind: 'trade',
            symbol: rawData.s,
            tradeId: parseInt(rawData.a),
            price: parseFloat(rawData.p),
            quantity: parseFloat(rawData.q),
            buyerMaker: rawData.m,
            tradeTime: rawData.T,
            eventTime: rawData.E,
            validated: true
        };
    }

    /**
     * Start kline stream
     */
    streamKlines(symbol, interval) {
        const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
        const wsUrl = `${this.config.wsBaseUrl}/ws/${streamName}`;
        
        console.log(`🌊 Starting kline stream: ${symbol} ${interval}`);
        
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            console.log(`✅ Kline stream connected: ${symbol} ${interval}`);
        });
        
        ws.on('message', (data) => {
            try {
                const rawData = JSON.parse(data.toString());
                
                // Normalize
                const normalized = this.normalizeKline(rawData);
                
                // Publish both legacy and new formats
                this.publish(`umf.candle.${symbol}.${interval}`, normalized);
                this.publish(`market.kline.${symbol}.${interval}.v1`, normalized);
                
            } catch (error) {
                console.error('❌ Kline parse error:', error.message);
                this.stats.errors++;
            }
        });
        
        ws.on('error', (error) => {
            console.error(`❌ Kline stream error: ${error.message}`);
            this.stats.errors++;
        });
        
        ws.on('close', () => {
            console.log(`📉 Kline stream closed: ${symbol} ${interval}`);
            
            // Auto-reconnect after 5 seconds
            setTimeout(() => {
                console.log(`🔄 Reconnecting kline stream: ${symbol} ${interval}`);
                this.streamKlines(symbol, interval);
            }, 5000);
        });
        
        this.activeStreams.set(`kline_${symbol}_${interval}`, ws);
        return ws;
    }

    /**
     * Start trade stream
     */
    streamTrades(symbol) {
        const streamName = `${symbol.toLowerCase()}@aggTrade`;
        const wsUrl = `${this.config.wsBaseUrl}/ws/${streamName}`;
        
        console.log(`💸 Starting trade stream: ${symbol}`);
        
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            console.log(`✅ Trade stream connected: ${symbol}`);
        });
        
        ws.on('message', (data) => {
            try {
                const rawData = JSON.parse(data.toString());
                
                // Normalize
                const normalized = this.normalizeTrade(rawData);
                
                // Publish both formats
                this.publish(`umf.trade.${symbol}`, normalized);
                this.publish(`market.trades.${symbol}.v1`, normalized);
                
            } catch (error) {
                console.error('❌ Trade parse error:', error.message);
                this.stats.errors++;
            }
        });
        
        ws.on('error', (error) => {
            console.error(`❌ Trade stream error: ${error.message}`);
            this.stats.errors++;
        });
        
        ws.on('close', () => {
            console.log(`💸 Trade stream closed: ${symbol}`);
            
            // Auto-reconnect after 5 seconds
            setTimeout(() => {
                console.log(`🔄 Reconnecting trade stream: ${symbol}`);
                this.streamTrades(symbol);
            }, 5000);
        });
        
        this.activeStreams.set(`trade_${symbol}`, ws);
        return ws;
    }

    /**
     * Start all configured streams
     */
    async start() {
        console.log('🚀 Starting Simple UMF...');
        
        // Time sync first
        await this.timeSync();
        
        // Start streams for each symbol
        for (const symbol of this.config.symbols) {
            if (this.config.streams.includes('kline_1m')) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
                this.streamKlines(symbol, '1m');
            }
            
            if (this.config.streams.includes('trade')) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
                this.streamTrades(symbol);
            }
        }
        
        console.log('✅ Simple UMF started successfully!');
        
        // Stats every 30 seconds
        setInterval(() => {
            const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
            const eventsPerSec = this.stats.totalEvents / runtime;
            
            console.log(`📊 Stats: ${this.stats.totalEvents} events, ${eventsPerSec.toFixed(1)}/sec, ${this.stats.errors} errors`);
        }, 30000);
    }

    /**
     * Stop all streams
     */
    stop() {
        console.log('🛑 Stopping Simple UMF...');
        
        for (const [key, ws] of this.activeStreams) {
            ws.close();
        }
        
        this.activeStreams.clear();
        console.log('✅ Simple UMF stopped');
    }

    /**
     * Get statistics
     */
    getStats() {
        const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        return {
            ...this.stats,
            runtime,
            eventsPerSecond: this.stats.totalEvents / runtime,
            activeStreams: this.activeStreams.size
        };
    }
}

module.exports = {
    SimpleUMF,
    bus
};
