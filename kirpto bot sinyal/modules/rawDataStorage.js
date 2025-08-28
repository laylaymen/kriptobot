/**
 * Raw Data Storage + Replay Engine
 * 
 * Stores all raw market data with gzip compression and hourly partitioning
 * Provides replay capabilities and feature materialization
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const EventEmitter = require('events');

class RawDataStorage extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            storageRoot: options.storageRoot || './data/raw',
            compression: options.compression !== false,
            compressionLevel: options.compressionLevel || 6,
            flushIntervalMs: options.flushIntervalMs || 60000, // 1 minute
            maxBufferSize: options.maxBufferSize || 10000,
            partitionInterval: options.partitionInterval || 'hourly', // hourly, daily
            enableFeatureStore: options.enableFeatureStore !== false,
            featureStoreRoot: options.featureStoreRoot || './data/features',
            ...options
        };
        
        // Message buffers by symbol and data type
        this.buffers = new Map(); // key: symbol_dataType -> messages[]
        this.partitionInfo = new Map(); // key: symbol_dataType -> { currentFile, startTime }
        
        // Feature store for materialized data
        this.featureStore = new Map(); // key: symbol_interval -> features
        
        // Statistics
        this.stats = {
            messagesStored: 0,
            bytesWritten: 0,
            filesCreated: 0,
            compressionRatio: 0,
            flushCount: 0,
            featuresComputed: 0,
            startTime: Date.now()
        };
        
        // Ensure storage directories exist
        this.ensureDirectories();
        
        // Start periodic flush
        this.flushTimer = setInterval(() => {
            this.flushAll();
        }, this.config.flushIntervalMs);
        
        console.log(`💾 Raw data storage initialized: ${this.config.storageRoot}`);
    }

    /**
     * Store raw market data message
     */
    store(symbol, dataType, message, metadata = {}) {
        const key = `${symbol}_${dataType}`;
        const timestamp = Date.now();
        
        // Create storage record
        const record = {
            timestamp,
            symbol,
            dataType,
            source: metadata.source || 'binance',
            sourceTimestamp: metadata.sourceTimestamp,
            latencyMs: timestamp - (metadata.sourceTimestamp || timestamp),
            sequence: metadata.sequence,
            messageSize: JSON.stringify(message).length,
            message
        };
        
        // Add to buffer
        if (!this.buffers.has(key)) {
            this.buffers.set(key, []);
        }
        
        this.buffers.get(key).push(record);
        this.stats.messagesStored++;
        
        // Check if buffer needs flushing
        if (this.buffers.get(key).length >= this.config.maxBufferSize) {
            this.flush(symbol, dataType);
        }
        
        // Emit storage event
        this.emit('stored', {
            symbol,
            dataType,
            timestamp,
            bufferSize: this.buffers.get(key).length
        });
    }

    /**
     * Flush buffer for specific symbol and data type
     */
    async flush(symbol, dataType) {
        const key = `${symbol}_${dataType}`;
        const buffer = this.buffers.get(key);
        
        if (!buffer || buffer.length === 0) return;
        
        try {
            const startTime = Date.now();
            const partitionPath = this.getPartitionPath(symbol, dataType, startTime);
            
            // Prepare data for writing
            const data = {
                metadata: {
                    symbol,
                    dataType,
                    flushTime: startTime,
                    messageCount: buffer.length,
                    timeRange: {
                        start: Math.min(...buffer.map(r => r.timestamp)),
                        end: Math.max(...buffer.map(r => r.timestamp))
                    }
                },
                messages: buffer
            };
            
            const jsonData = JSON.stringify(data, null, 0);
            const uncompressedSize = Buffer.byteLength(jsonData, 'utf8');
            
            // Write data (compressed or uncompressed)
            if (this.config.compression) {
                const compressed = zlib.gzipSync(jsonData, { level: this.config.compressionLevel });
                await fs.promises.writeFile(partitionPath + '.gz', compressed);
                
                const compressionRatio = compressed.length / uncompressedSize;
                this.stats.compressionRatio = (this.stats.compressionRatio + compressionRatio) / 2;
                this.stats.bytesWritten += compressed.length;
            } else {
                await fs.promises.writeFile(partitionPath, jsonData);
                this.stats.bytesWritten += uncompressedSize;
            }
            
            // Update statistics
            this.stats.flushCount++;
            this.stats.filesCreated++;
            
            // Clear buffer
            this.buffers.set(key, []);
            
            const flushDuration = Date.now() - startTime;
            console.log(`💾 Flushed ${buffer.length} messages for ${key} in ${flushDuration}ms (${(uncompressedSize/1024).toFixed(1)}KB)`);
            
            this.emit('flushed', {
                symbol,
                dataType,
                messageCount: buffer.length,
                filePath: partitionPath,
                flushDuration,
                uncompressedSize,
                compressionRatio: this.stats.compressionRatio
            });
            
            // Update features if enabled
            if (this.config.enableFeatureStore && dataType === 'kline') {
                this.updateFeatures(symbol, data.messages);
            }
            
        } catch (error) {
            console.error(`❌ Failed to flush ${key}:`, error);
            this.emit('error', error);
        }
    }

    /**
     * Flush all buffers
     */
    async flushAll() {
        const keys = Array.from(this.buffers.keys());
        const flushPromises = [];
        
        for (const key of keys) {
            const [symbol, dataType] = key.split('_');
            flushPromises.push(this.flush(symbol, dataType));
        }
        
        if (flushPromises.length > 0) {
            await Promise.all(flushPromises);
            console.log(`💾 Flushed all buffers (${keys.length} types)`);
        }
    }

    /**
     * Get partition file path based on timestamp
     */
    getPartitionPath(symbol, dataType, timestamp) {
        const date = new Date(timestamp);
        
        let partitionDir, fileName;
        
        if (this.config.partitionInterval === 'hourly') {
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            const hour = String(date.getUTCHours()).padStart(2, '0');
            
            partitionDir = path.join(this.config.storageRoot, symbol, dataType, String(year), month, day);
            fileName = `${dataType}_${hour}.json`;
        } else { // daily
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            
            partitionDir = path.join(this.config.storageRoot, symbol, dataType, String(year), month);
            fileName = `${dataType}_${day}.json`;
        }
        
        // Ensure directory exists
        fs.mkdirSync(partitionDir, { recursive: true });
        
        return path.join(partitionDir, fileName);
    }

    /**
     * Read raw data for replay
     */
    async read(symbol, dataType, startTime, endTime, options = {}) {
        const messages = [];
        const partitions = this.getPartitionsInRange(symbol, dataType, startTime, endTime);
        
        for (const partitionPath of partitions) {
            try {
                const data = await this.readPartition(partitionPath);
                
                // Filter messages by time range
                const filteredMessages = data.messages.filter(msg => 
                    msg.timestamp >= startTime && msg.timestamp <= endTime
                );
                
                messages.push(...filteredMessages);
                
            } catch (error) {
                console.warn(`⚠️ Failed to read partition ${partitionPath}:`, error.message);
                continue;
            }
        }
        
        // Sort by timestamp
        messages.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`📖 Read ${messages.length} messages for ${symbol}_${dataType} from ${new Date(startTime)} to ${new Date(endTime)}`);
        
        return messages;
    }

    /**
     * Read single partition file
     */
    async readPartition(partitionPath) {
        const isCompressed = partitionPath.endsWith('.gz');
        
        if (isCompressed) {
            const compressedData = await fs.promises.readFile(partitionPath);
            const decompressed = zlib.gunzipSync(compressedData);
            return JSON.parse(decompressed.toString());
        } else {
            const rawData = await fs.promises.readFile(partitionPath, 'utf8');
            return JSON.parse(rawData);
        }
    }

    /**
     * Get partition files for time range
     */
    getPartitionsInRange(symbol, dataType, startTime, endTime) {
        const partitions = [];
        const baseDir = path.join(this.config.storageRoot, symbol, dataType);
        
        if (!fs.existsSync(baseDir)) return partitions;
        
        // Recursive search for partition files
        const searchFiles = (dir, currentTime) => {
            if (!fs.existsSync(dir)) return;
            
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    searchFiles(fullPath, currentTime);
                } else if (entry.isFile() && entry.name.includes(dataType)) {
                    // Extract timestamp from filename to check if in range
                    const stats = fs.statSync(fullPath);
                    if (stats.mtime >= new Date(startTime) && stats.mtime <= new Date(endTime)) {
                        partitions.push(fullPath);
                    }
                }
            }
        };
        
        searchFiles(baseDir);
        
        return partitions.sort();
    }

    /**
     * Replay data stream
     */
    async replay(symbol, dataType, startTime, endTime, options = {}) {
        const { 
            speedMultiplier = 1,
            emitEvents = true,
            batchSize = 100 
        } = options;
        
        console.log(`🔄 Starting replay for ${symbol}_${dataType} from ${new Date(startTime)} to ${new Date(endTime)} (speed: ${speedMultiplier}x)`);
        
        const messages = await this.read(symbol, dataType, startTime, endTime);
        
        if (messages.length === 0) {
            console.log(`📭 No messages found for replay`);
            return;
        }
        
        const startReplayTime = Date.now();
        let lastMessageTime = messages[0].timestamp;
        
        for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);
            
            // Calculate delay based on message timestamps
            if (i > 0) {
                const timeDiff = batch[0].timestamp - lastMessageTime;
                const adjustedDelay = timeDiff / speedMultiplier;
                
                if (adjustedDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, adjustedDelay));
                }
            }
            
            // Emit batch
            if (emitEvents) {
                this.emit('replay_batch', {
                    symbol,
                    dataType,
                    messages: batch,
                    progress: (i + batch.length) / messages.length,
                    batchIndex: Math.floor(i / batchSize)
                });
            }
            
            lastMessageTime = batch[batch.length - 1].timestamp;
        }
        
        const replayDuration = Date.now() - startReplayTime;
        console.log(`✅ Replay completed: ${messages.length} messages in ${replayDuration}ms`);
        
        this.emit('replay_complete', {
            symbol,
            dataType,
            messageCount: messages.length,
            replayDuration,
            speedMultiplier
        });
    }

    /**
     * Update feature store with kline data
     */
    updateFeatures(symbol, messages) {
        const klineMessages = messages.filter(msg => msg.dataType === 'kline');
        
        for (const msg of klineMessages) {
            const kline = msg.message;
            const key = `${symbol}_${kline.interval}`;
            
            if (!this.featureStore.has(key)) {
                this.featureStore.set(key, []);
            }
            
            const features = this.featureStore.get(key);
            
            // Calculate basic features
            const feature = {
                timestamp: kline.openTime,
                interval: kline.interval,
                symbol,
                ohlc: {
                    open: parseFloat(kline.open),
                    high: parseFloat(kline.high),
                    low: parseFloat(kline.low),
                    close: parseFloat(kline.close)
                },
                volume: parseFloat(kline.volume),
                vwap: this.calculateVWAP(kline),
                volatility: this.calculateVolatility(features, parseFloat(kline.close)),
                rsi: this.calculateRSI(features, parseFloat(kline.close)),
                computedAt: Date.now()
            };
            
            features.push(feature);
            
            // Keep only last 1000 features per symbol/interval
            if (features.length > 1000) {
                features.splice(0, features.length - 1000);
            }
            
            this.stats.featuresComputed++;
        }
    }

    /**
     * Calculate VWAP for kline
     */
    calculateVWAP(kline) {
        const volume = parseFloat(kline.volume);
        const quoteVolume = parseFloat(kline.quoteAssetVolume);
        
        return volume > 0 ? quoteVolume / volume : parseFloat(kline.close);
    }

    /**
     * Calculate volatility (simple rolling std dev)
     */
    calculateVolatility(features, currentPrice, period = 20) {
        if (features.length < period) return null;
        
        const prices = features.slice(-period).map(f => f.ohlc.close);
        prices.push(currentPrice);
        
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
        
        return Math.sqrt(variance);
    }

    /**
     * Calculate RSI (simple implementation)
     */
    calculateRSI(features, currentPrice, period = 14) {
        if (features.length < period) return null;
        
        const prices = features.slice(-period).map(f => f.ohlc.close);
        prices.push(currentPrice);
        
        let gains = 0, losses = 0;
        
        for (let i = 1; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    /**
     * Get materialized features
     */
    getFeatures(symbol, interval, count = 100) {
        const key = `${symbol}_${interval}`;
        const features = this.featureStore.get(key) || [];
        
        return features.slice(-count);
    }

    /**
     * Ensure storage directories exist
     */
    ensureDirectories() {
        fs.mkdirSync(this.config.storageRoot, { recursive: true });
        
        if (this.config.enableFeatureStore) {
            fs.mkdirSync(this.config.featureStoreRoot, { recursive: true });
        }
    }

    /**
     * Get storage statistics
     */
    getStats() {
        const runtime = Date.now() - this.stats.startTime;
        const runtimeHours = runtime / 3600000;
        
        const bufferStats = {};
        for (const [key, buffer] of this.buffers) {
            bufferStats[key] = buffer.length;
        }
        
        return {
            ...this.stats,
            runtime,
            runtimeHours,
            messagesPerHour: this.stats.messagesStored / runtimeHours,
            averageCompressionRatio: this.stats.compressionRatio,
            bufferStats,
            featureStoreSize: this.featureStore.size,
            totalFeatures: Array.from(this.featureStore.values()).reduce((sum, features) => sum + features.length, 0)
        };
    }

    /**
     * Stop storage and flush all buffers
     */
    async stop() {
        console.log(`🛑 Stopping raw data storage...`);
        
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        
        await this.flushAll();
        
        console.log(`✅ Raw data storage stopped`);
        this.emit('stopped');
    }
}

module.exports = { RawDataStorage };
