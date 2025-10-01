/**
 * Production UMF Demo - Full Enhanced Pipeline
 * 
 * Demonstrates the complete production-quality Enhanced UMF with:
 * - Full Binance API support with all filters and rate limits
 * - L2 orderbook validation with sequence gap detection
 * - Raw data storage with compression and replay
 * - Clock sync monitoring
 * - Schema versioning and validation
 * - Comprehensive error handling and monitoring
 * - Live dashboard and health monitoring
 */

const { EnhancedUMF } = require('./kirpto bot sinyal/modules/enhancedUMF');

class ProductionUMFDemo {
    constructor() {
        this.umf = null;
        this.stats = {
            startTime: Date.now(),
            eventsReceived: 0,
            errorsSeen: 0,
            resyncsTriggered: 0,
            clockSkewWarnings: 0,
            rateLimitHits: 0,
            storageFlushes: 0
        };
        this.isRunning = false;
        this.dashboardInterval = null;
    }

    /**
     * Run the comprehensive Enhanced UMF demonstration
     */
    async run() {
        console.log('🏭 Production Enhanced UMF Demo');
        console.log('═'.repeat(80));
        console.log('🚀 Initializing production-quality pipeline with all features...\n');
        
        try {
            await this.initializeEnhancedUMF();
            this.setupComprehensiveEventHandlers();
            this.startLiveDashboard();
            this.demonstrateFeatures();
            
            this.isRunning = true;
            console.log('✅ Production Enhanced UMF Demo is now LIVE!');
            console.log('📊 Dashboard will refresh every 20 seconds');
            console.log('🔴 Press Ctrl+C to stop gracefully\n');
            
        } catch (error) {
            console.error('❌ Demo initialization failed:', error);
            process.exit(1);
        }
    }

    /**
     * Initialize Enhanced UMF with full production configuration
     */
    async initializeEnhancedUMF() {
        console.log('🔧 Configuring Enhanced UMF with production settings...');
        
        this.umf = new EnhancedUMF({
            // Symbol and data configuration
            symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT'],
            intervals: ['1m', '5m', '15m'],
            
            // Enable all quality features
            enableValidation: true,
            enableStorage: true,
            enableOrderbook: true,
            enableClockSync: true,
            
            // Rate limiting configuration
            rateLimiter: {
                requestWeight: {
                    maxRequestsPerMinute: 1200,
                    warningThreshold: 0.8
                },
                orderWeight: {
                    maxOrdersPerSecond: 10,
                    maxOrdersPerDay: 200000,
                    warningThreshold: 0.8
                },
                minBackoff: 1000,
                maxBackoff: 60000,
                backoffMultiplier: 2.0,
                enableQueue: true,
                maxQueueSize: 1000
            },
            
            // Clock sync configuration
            clockSync: {
                syncIntervalMs: 30000,
                maxSkewMs: 1000,
                warningSkewMs: 500,
                ntpServers: ['pool.ntp.org', 'time.google.com'],
                enableNtpFallback: true
            },
            
            // Storage configuration
            storage: {
                storageRoot: './data/production-umf',
                compression: true,
                compressionLevel: 6,
                flushIntervalMs: 30000,
                partitionInterval: 'hourly',
                enableFeatureStore: true,
                retentionDays: 30
            },
            
            // WebSocket configuration
            maxReconnectAttempts: 10,
            reconnectDelayMs: 1000,
            heartbeatIntervalMs: 30000,
            
            // Schema and validation
            schemaVersion: '2.0',
            strictValidation: true,
            enableDeduplication: true,
            enableIdempotency: true
        });
        
        console.log('⏳ Starting Enhanced UMF initialization...');
        await this.umf.initialize();
        console.log('✅ Enhanced UMF initialized successfully!\n');
    }

    /**
     * Setup comprehensive event handlers for all pipeline components
     */
    setupComprehensiveEventHandlers() {
        console.log('📡 Setting up comprehensive event handlers...');
        
        // Core market data events
        this.setupMarketDataHandlers();
        
        // Quality and operational events
        this.setupQualityEventHandlers();
        
        // System and health events
        this.setupSystemEventHandlers();
        
        console.log('✅ All event handlers configured\n');
    }

    /**
     * Setup market data event handlers
     */
    setupMarketDataHandlers() {
        // Kline events with validation and enrichment display
        this.umf.on('umf.kline.BTCUSDT.1m', (kline) => {
            this.stats.eventsReceived++;
            const price = parseFloat(kline.close);
            const volume = parseFloat(kline.volume);
            const changePercent = kline.features?.priceChange24h ? (kline.features.priceChange24h * 100).toFixed(2) : 'N/A';
            
            if (kline.closed) {
                console.log(`📊 BTC 1m CLOSED: $${price.toLocaleString()} (vol: ${volume.toFixed(2)}) [${changePercent}%] [ID: ${kline.messageId?.slice(-8)}]`);
            }
        });
        
        // Trade events for significant trades
        this.umf.on('umf.trade.BTCUSDT', (trade) => {
            this.stats.eventsReceived++;
            const notionalValue = parseFloat(trade.price) * parseFloat(trade.quantity);
            
            if (notionalValue > 50000) { // Only log trades > $50k
                console.log(`💸 BTC Large Trade: $${parseFloat(trade.price).toLocaleString()} x ${parseFloat(trade.quantity).toFixed(4)} = $${notionalValue.toLocaleString()} [${trade.isBuyerMaker ? 'SELL' : 'BUY'}]`);
            }
        });
        
        // ETH klines for comparison
        this.umf.on('umf.kline.ETHUSDT.5m', (kline) => {
            this.stats.eventsReceived++;
            if (kline.closed) {
                const price = parseFloat(kline.close);
                const volume = parseFloat(kline.volume);
                console.log(`📈 ETH 5m: $${price.toLocaleString()} (vol: ${volume.toFixed(2)})`);
            }
        });
        
        // Ticker events for spread monitoring
        this.umf.on('umf.ticker.BNBUSDT', (ticker) => {
            this.stats.eventsReceived++;
            const bid = parseFloat(ticker.bidPrice);
            const ask = parseFloat(ticker.askPrice);
            const spread = ask - bid;
            const spreadBps = (spread / bid) * 10000;
            
            if (spreadBps > 10) { // Alert on wide spreads
                console.log(`📊 BNB Wide Spread: ${spread.toFixed(4)} (${spreadBps.toFixed(2)} bps) [${ticker.messageId?.slice(-8)}]`);
            }
        });
        
        // Orderbook events
        this.umf.on('umf.depth.BTCUSDT', (depth) => {
            this.stats.eventsReceived++;
            if (depth.kind === 'depthSnapshot') {
                console.log(`📖 BTC Orderbook Snapshot: ${depth.bids.length} bids, ${depth.asks.length} asks (updateId: ${depth.lastUpdateId})`);
            }
        });
    }

    /**
     * Setup quality and operational event handlers
     */
    setupQualityEventHandlers() {
        // Validation errors
        this.umf.on('umf.error.validation', (error) => {
            this.stats.errorsSeen++;
            console.warn(`⚠️ Validation Error [${error.symbol}]: ${error.message} (Field: ${error.field})`);
        });
        
        // Sequence gap detection and resyncs
        this.umf.on('umf.error.BTCUSDT', (error) => {
            this.stats.errorsSeen++;
            if (error.errorType === 'SEQUENCE_GAP') {
                this.stats.resyncsTriggered++;
                console.error(`🔄 SEQUENCE GAP detected for ${error.symbol}: Expected ${error.expected}, got ${error.actual}. Triggering resync...`);
            }
        });
        
        // Clock sync events
        if (this.umf.clockSync) {
            this.umf.clockSync.on('critical_skew', (data) => {
                this.stats.clockSkewWarnings++;
                console.error(`🚨 CRITICAL CLOCK SKEW: ${data.skewMs}ms (threshold: ${data.threshold}ms)`);
            });
            
            this.umf.clockSync.on('sync_success', (data) => {
                if (data.skewMs > 100) { // Log significant skews
                    console.log(`🕐 Clock sync: ${data.skewMs.toFixed(2)}ms skew (${data.source})`);
                }
            });
            
            this.umf.clockSync.on('sync_failure', (data) => {
                console.error(`🚨 Clock sync failure: ${data.consecutiveFailures} consecutive failures`);
            });
        }
        
        // Rate limiting events
        this.umf.rateLimiter.on('rate_limit_hit', (data) => {
            this.stats.rateLimitHits++;
            console.warn(`🚦 Rate limit hit: ${data.limitType} (${data.current}/${data.max})`);
        });
        
        this.umf.rateLimiter.on('backoff_start', (data) => {
            console.warn(`⏳ Entering backoff: ${data.duration}ms (attempt ${data.attempt})`);
        });
        
        this.umf.rateLimiter.on('queue_full', (data) => {
            console.error(`🚫 Request queue full: ${data.queueSize} requests dropped`);
        });
        
        // Storage events
        if (this.umf.dataStorage) {
            this.umf.dataStorage.on('flushed', (data) => {
                this.stats.storageFlushes++;
                const compressionPct = (data.compressionRatio * 100).toFixed(1);
                console.log(`💾 Storage flush: ${data.messageCount} ${data.symbol}_${data.dataType} messages (${compressionPct}% compressed)`);
            });
            
            this.umf.dataStorage.on('partition_rotated', (data) => {
                console.log(`🔄 Storage partition rotated: ${data.oldFile} → ${data.newFile}`);
            });
            
            this.umf.dataStorage.on('feature_computed', (data) => {
                console.log(`🧮 Feature computed: ${data.symbol} ${data.featureType} (${data.windowSize}ms window)`);
            });
        }
    }

    /**
     * Setup system and health event handlers
     */
    setupSystemEventHandlers() {
        // Connection events
        this.umf.on('stream_connected', (data) => {
            console.log(`✅ Stream connected: ${data.streamName}`);
        });
        
        this.umf.on('stream_disconnected', (data) => {
            console.warn(`⚠️ Stream disconnected: ${data.streamName} (code: ${data.code})`);
        });
        
        this.umf.on('stream_failed', (data) => {
            console.error(`❌ Stream permanently failed: ${data.streamName} (${data.attempts} attempts)`);
        });
        
        // Orderbook validator events
        this.umf.on('orderbook_error', (data) => {
            console.error(`❌ Orderbook error for ${data.symbol}:`, data.error.message);
        });
        
        this.umf.on('orderbook_resync', (data) => {
            console.log(`🔄 Orderbook resync for ${data.symbol}: sequence ${data.fromSequence} → ${data.toSequence}`);
        });
        
        // Heartbeat events
        this.umf.on('umf.heartbeat', (heartbeat) => {
            // Use heartbeat for periodic health checks
            this.performHealthCheck(heartbeat);
        });
        
        // System errors
        this.umf.on('system_error', (error) => {
            console.error(`🚨 System error: ${error.message}`);
            if (error.severity === 'critical') {
                console.error('🚨 CRITICAL ERROR - System may need restart');
            }
        });
    }

    /**
     * Start live dashboard showing comprehensive statistics
     */
    startLiveDashboard() {
        console.log('📊 Starting live dashboard...\n');
        
        this.dashboardInterval = setInterval(() => {
            if (this.isRunning) {
                this.displayLiveDashboard();
            }
        }, 20000); // Update every 20 seconds
    }

    /**
     * Display comprehensive live dashboard
     */
    displayLiveDashboard() {
        console.clear();
        console.log('🏭 Production Enhanced UMF - Live Dashboard');
        console.log('═'.repeat(80));
        
        const stats = this.umf.getStats();
        const runtimeMinutes = (Date.now() - this.stats.startTime) / 60000;
        
        // System overview
        console.log(`\n📊 System Overview (Runtime: ${runtimeMinutes.toFixed(1)}m)`);
        console.log(`   Schema Version: ${this.umf.config.schemaVersion}`);
        console.log(`   Messages received: ${stats.messagesReceived.toLocaleString()}`);
        console.log(`   Messages published: ${stats.messagesPublished.toLocaleString()}`);
        console.log(`   Messages per minute: ${stats.messagesPerMinute.toFixed(1)}`);
        console.log(`   Drop rate: ${stats.dropRate.toFixed(2)}%`);
        console.log(`   Duplicate rate: ${stats.duplicateRate.toFixed(2)}%`);
        console.log(`   Validation errors: ${stats.validationErrors}`);
        console.log(`   Demo events seen: ${this.stats.eventsReceived.toLocaleString()}`);
        
        // Exchange Rules Guard Status
        console.log(`\n🛡️ Exchange Rules Guard`);
        console.log(`   Symbols loaded: ${stats.rulesGuard.symbolCount}`);
        console.log(`   Rules version: ${stats.rulesGuard.rulesVersion}`);
        console.log(`   Rules age: ${stats.rulesGuard.ageMinutes.toFixed(1)} minutes`);
        console.log(`   Is stale: ${stats.rulesGuard.isStale ? '⚠️ YES' : '✅ NO'}`);
        
        // Rate Limiter Status
        console.log(`\n🚦 Rate Limiter Status`);
        const rlStats = stats.rateLimiter;
        console.log(`   Total requests: ${rlStats.totalRequests}`);
        console.log(`   Success rate: ${(rlStats.successRate * 100).toFixed(1)}%`);
        console.log(`   Rate limit hits: ${rlStats.rateLimitHits} (Demo: ${this.stats.rateLimitHits})`);
        console.log(`   Current backoff: ${rlStats.isInBackoff ? '🛑 YES' : '✅ NO'}`);
        console.log(`   Request weight: ${rlStats.limits.requestWeight.current}/${rlStats.limits.requestWeight.max} (${rlStats.limits.requestWeight.percentage.toFixed(1)}%)`);
        console.log(`   Queue sizes: C:${rlStats.queues.critical} H:${rlStats.queues.high} N:${rlStats.queues.normal} L:${rlStats.queues.low}`);
        
        // Clock Sync Status
        if (stats.clockSync) {
            console.log(`\n🕐 Clock Sync Monitor`);
            const csStats = stats.clockSync;
            console.log(`   Current skew: ${csStats.currentStatus.currentSkewMs.toFixed(2)}ms`);
            console.log(`   Average skew: ${csStats.averageSkew.toFixed(2)}ms`);
            console.log(`   Health status: ${csStats.currentStatus.isHealthy ? '✅ HEALTHY' : '⚠️ UNHEALTHY'}`);
            console.log(`   Sync source: ${csStats.currentStatus.lastSyncSource || 'N/A'}`);
            console.log(`   Measurements: ${csStats.totalMeasurements}`);
            console.log(`   Healthy rate: ${csStats.healthyPercentage.toFixed(1)}%`);
            console.log(`   Warnings: ${this.stats.clockSkewWarnings}`);
        }
        
        // Data Storage Status
        if (stats.dataStorage) {
            console.log(`\n💾 Data Storage`);
            const dsStats = stats.dataStorage;
            console.log(`   Messages stored: ${dsStats.messagesStored.toLocaleString()}`);
            console.log(`   Files created: ${dsStats.filesCreated}`);
            console.log(`   Bytes written: ${(dsStats.bytesWritten / 1024 / 1024).toFixed(2)} MB`);
            console.log(`   Avg compression: ${(dsStats.averageCompressionRatio * 100).toFixed(1)}%`);
            console.log(`   Flush count: ${dsStats.flushCount} (Demo: ${this.stats.storageFlushes})`);
            console.log(`   Features computed: ${dsStats.featuresComputed}`);
            console.log(`   Feature store symbols: ${dsStats.featureStoreSize}`);
        }
        
        // Connection Status
        console.log(`\n🔌 WebSocket Connections`);
        const connectionCount = Object.keys(stats.connections).length;
        const connectedCount = Object.values(stats.connections).filter(state => state === 'connected').length;
        console.log(`   Total connections: ${connectionCount}`);
        console.log(`   Connected: ${connectedCount}/${connectionCount}`);
        console.log(`   Connection drops: ${stats.connectionDrops}`);
        console.log(`   Reconnect attempts: ${stats.reconnectAttempts}`);
        
        // Orderbook Validators
        if (stats.orderbookValidators && Object.keys(stats.orderbookValidators).length > 0) {
            console.log(`\n📖 Orderbook Validators`);
            for (const [symbol, obStats] of Object.entries(stats.orderbookValidators)) {
                const status = obStats.isReady ? '✅' : obStats.isSyncing ? '🔄' : '⚠️';
                const spread = obStats.spread;
                console.log(`   ${symbol}: ${status} | Updates: ${obStats.updatesApplied} | Success: ${obStats.successRate.toFixed(1)}% | Spread: ${spread ? spread.spreadBps.toFixed(2) + ' bps' : 'N/A'}`);
                if (obStats.sequenceGaps > 0) {
                    console.log(`     - Sequence gaps: ${obStats.sequenceGaps} (resyncs: ${this.stats.resyncsTriggered})`);
                }
            }
        }
        
        // Message Statistics by Symbol and Type
        console.log(`\n📈 Message Statistics by Symbol`);
        for (const [symbol, symbolStats] of Object.entries(stats.bySymbol)) {
            console.log(`   ${symbol}: ${symbolStats.total.toLocaleString()} total`);
            for (const [type, count] of Object.entries(symbolStats.types)) {
                console.log(`     - ${type}: ${count.toLocaleString()}`);
            }
        }
        
        // Error Summary
        console.log(`\n⚠️ Error Summary`);
        console.log(`   Demo errors seen: ${this.stats.errorsSeen}`);
        console.log(`   Validation errors: ${stats.validationErrors}`);
        console.log(`   Connection errors: ${stats.connectionErrors || 0}`);
        console.log(`   Orderbook resyncs: ${this.stats.resyncsTriggered}`);
        
        console.log('\n═'.repeat(80));
        console.log('📡 Live Events (latest appear below):');
    }

    /**
     * Demonstrate advanced features periodically
     */
    demonstrateFeatures() {
        // Demonstrate data replay every 10 minutes
        if (this.umf.dataStorage) {
            setTimeout(() => {
                this.demonstrateDataReplay();
            }, 10 * 60 * 1000);
        }
        
        // Show feature store data every 5 minutes
        setTimeout(() => {
            this.showFeatureStoreData();
        }, 5 * 60 * 1000);
    }

    /**
     * Demonstrate data replay functionality
     */
    async demonstrateDataReplay() {
        if (!this.umf.dataStorage) return;
        
        console.log('\n🔄 === DATA REPLAY DEMONSTRATION ===');
        
        const endTime = Date.now();
        const startTime = endTime - (10 * 60 * 1000); // Last 10 minutes
        
        try {
            // Read stored kline data
            const klineData = await this.umf.dataStorage.read('BTCUSDT', 'kline', startTime, endTime);
            console.log(`📖 Found ${klineData.length} stored kline messages for replay`);
            
            if (klineData.length > 0) {
                console.log('▶️ Starting replay at 50x speed...');
                
                // Start replay
                this.umf.dataStorage.replay('BTCUSDT', 'kline', startTime, endTime, {
                    speedMultiplier: 50,
                    emitEvents: true,
                    batchSize: 10
                });
                
                // Listen for replay events
                this.umf.dataStorage.on('replay_batch', (data) => {
                    console.log(`🔄 Replay: ${data.messages.length} msgs (${(data.progress * 100).toFixed(1)}% complete)`);
                });
                
                this.umf.dataStorage.on('replay_complete', (data) => {
                    console.log(`✅ Replay complete: ${data.messageCount} messages in ${data.replayDuration}ms`);
                    console.log('🔄 === END REPLAY DEMONSTRATION ===\n');
                });
            }
            
        } catch (error) {
            console.error(`❌ Replay demonstration failed:`, error.message);
        }
    }

    /**
     * Show feature store data
     */
    showFeatureStoreData() {
        if (!this.umf.dataStorage || !this.umf.dataStorage.featureStore) return;
        
        console.log('\n🧮 === FEATURE STORE DATA ===');
        
        const features = this.umf.dataStorage.getFeatures('BTCUSDT');
        if (features) {
            console.log('📊 BTC Features:');
            if (features.vwap) console.log(`   VWAP (1h): $${features.vwap.toFixed(2)}`);
            if (features.volatility) console.log(`   Volatility (1h): ${(features.volatility * 100).toFixed(2)}%`);
            if (features.volume24h) console.log(`   Volume (24h): ${features.volume24h.toFixed(2)} BTC`);
            if (features.priceChange24h) console.log(`   Price Change (24h): ${(features.priceChange24h * 100).toFixed(2)}%`);
            if (features.tradeCount1h) console.log(`   Trades (1h): ${features.tradeCount1h}`);
        }
        
        console.log('🧮 === END FEATURE STORE ===\n');
    }

    /**
     * Perform periodic health check
     */
    performHealthCheck(heartbeat) {
        const stats = this.umf.getStats();
        
        // Check for concerning metrics
        if (stats.dropRate > 5) {
            console.warn(`⚠️ Health Alert: High drop rate ${stats.dropRate.toFixed(2)}%`);
        }
        
        if (stats.validationErrors > 50) {
            console.warn(`⚠️ Health Alert: High validation errors (${stats.validationErrors})`);
        }
        
        if (stats.messagesPerMinute < 10) {
            console.warn(`⚠️ Health Alert: Low message rate (${stats.messagesPerMinute.toFixed(1)}/min)`);
        }
    }

    /**
     * Stop the demo gracefully
     */
    async stop() {
        console.log('\n🛑 Stopping Production Enhanced UMF Demo...');
        
        this.isRunning = false;
        
        if (this.dashboardInterval) {
            clearInterval(this.dashboardInterval);
        }
        
        if (this.umf) {
            await this.umf.stop();
        }
        
        // Final statistics
        const runtimeMinutes = (Date.now() - this.stats.startTime) / 60000;
        console.log('\n📊 Final Demo Statistics:');
        console.log(`   Runtime: ${runtimeMinutes.toFixed(1)} minutes`);
        console.log(`   Events received: ${this.stats.eventsReceived.toLocaleString()}`);
        console.log(`   Errors seen: ${this.stats.errorsSeen}`);
        console.log(`   Resyncs triggered: ${this.stats.resyncsTriggered}`);
        console.log(`   Clock skew warnings: ${this.stats.clockSkewWarnings}`);
        console.log(`   Rate limit hits: ${this.stats.rateLimitHits}`);
        console.log(`   Storage flushes: ${this.stats.storageFlushes}`);
        
        console.log('\n✅ Production Enhanced UMF Demo stopped gracefully');
    }
}

// Run the production demo
if (require.main === module) {
    const demo = new ProductionUMFDemo();
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        await demo.stop();
        process.exit(0);
    });
    
    demo.run().catch(console.error);
}

module.exports = { ProductionUMFDemo };
