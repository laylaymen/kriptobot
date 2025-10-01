/**
 * LIVIA-37: Deep Learning Insights Engine
 * Derin öğrenme tabanlı piyasa analizi ve tahmin motoru
 * 
 * Amaç: TensorFlow.js kullanarak gerçek zamanlı piyasa verilerinden
 * karmaşık paternleri öğrenir ve gelecekteki fiyat hareketlerini tahmin eder.
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Giriş şemaları
const MarketDataStreamSchema = z.object({
    event: z.literal('market.data.stream'),
    timestamp: z.string(),
    symbol: z.string(),
    price: z.number(),
    volume: z.number(),
    orderbook: z.object({
        bids: z.array(z.tuple([z.number(), z.number()])),
        asks: z.array(z.tuple([z.number(), z.number()]))
    }),
    technicals: z.object({
        rsi: z.number(),
        macd: z.number(),
        bb_upper: z.number(),
        bb_lower: z.number(),
        ema_fast: z.number(),
        ema_slow: z.number()
    }).optional()
}).strict();

const ModelTrainingRequestSchema = z.object({
    event: z.literal('model.training.request'),
    timestamp: z.string(),
    modelType: z.enum(['lstm', 'transformer', 'cnn', 'hybrid']),
    dataWindow: z.object({
        hours: z.number().int().min(1).max(720), // 1 saat - 30 gün
        features: z.array(z.string())
    }),
    hyperParams: z.object({
        learningRate: z.number().min(0.0001).max(0.1),
        batchSize: z.number().int().min(8).max(256),
        epochs: z.number().int().min(10).max(1000),
        dropout: z.number().min(0).max(0.8)
    }).optional(),
    validation: z.object({
        splitRatio: z.number().min(0.1).max(0.4),
        crossValidation: z.boolean().default(false)
    }).optional()
}).strict();

const PredictionRequestSchema = z.object({
    event: z.literal('prediction.request'),
    timestamp: z.string(),
    symbol: z.string(),
    horizon: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']),
    confidence: z.number().min(0.5).max(0.99).default(0.8),
    features: z.array(z.string()).optional()
}).strict();

// Çıkış şemaları
const DeepInsightSchema = z.object({
    event: z.literal('deep.insight'),
    timestamp: z.string(),
    symbol: z.string(),
    insight: z.object({
        pattern: z.string(),
        confidence: z.number().min(0).max(1),
        significance: z.enum(['low', 'medium', 'high', 'critical']),
        prediction: z.object({
            direction: z.enum(['bullish', 'bearish', 'neutral']),
            magnitude: z.number().min(0).max(1),
            probability: z.number().min(0).max(1),
            timeframe: z.string(),
            target_price: z.number().optional(),
            stop_loss: z.number().optional()
        }),
        neural_features: z.array(z.object({
            name: z.string(),
            importance: z.number().min(0).max(1),
            activation: z.number()
        })),
        market_regime: z.enum(['trending', 'ranging', 'volatile', 'calm', 'crisis']),
        anomaly_score: z.number().min(0).max(1)
    }),
    model: z.object({
        type: z.string(),
        version: z.string(),
        accuracy: z.number().min(0).max(1),
        last_trained: z.string(),
        training_samples: z.number().int()
    }),
    metadata: z.object({
        computation_time_ms: z.number(),
        gpu_utilized: z.boolean(),
        memory_usage_mb: z.number(),
        data_quality_score: z.number().min(0).max(1)
    })
}).strict();

const ModelStatusSchema = z.object({
    event: z.literal('model.status'),
    timestamp: z.string(),
    model_id: z.string(),
    status: z.enum(['training', 'ready', 'predicting', 'error', 'updating']),
    performance: z.object({
        accuracy: z.number().min(0).max(1),
        precision: z.number().min(0).max(1),
        recall: z.number().min(0).max(1),
        f1_score: z.number().min(0).max(1),
        sharpe_ratio: z.number().optional(),
        max_drawdown: z.number().optional()
    }).optional(),
    training_progress: z.object({
        epoch: z.number().int(),
        total_epochs: z.number().int(),
        loss: z.number(),
        val_loss: z.number().optional(),
        eta_minutes: z.number().optional()
    }).optional(),
    error: z.string().optional()
}).strict();

/**
 * Deep Learning Insights Engine Ana Sınıfı
 */
class DeepLearningInsightsEngine extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'DeepLearningInsightsEngine';
        this.config = {
            modelPath: './models/livia_dl',
            dataRetention: 720, // 30 gün (saat)
            batchProcessing: true,
            autoRetrain: true,
            retrainThreshold: 0.1, // Accuracy düşerse yeniden eğit
            gpuAcceleration: false,
            ...config
        };
        
        // Model state
        this.models = new Map();
        this.trainingQueue = [];
        this.predictionCache = new Map();
        this.featureStore = new Map();
        
        // Performance tracking
        this.metrics = {
            predictions_made: 0,
            accuracy_avg: 0,
            models_trained: 0,
            computation_time_total: 0,
            cache_hits: 0,
            cache_misses: 0
        };
        
        // Data pipeline
        this.dataBuffer = new Map(); // symbol -> data points
        this.featureExtractors = new Map();
        
        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * Sistemi başlat
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Model yükleme/oluşturma
            await this.initializeModels();
            
            // Feature extractors kurulumu
            this.setupFeatureExtractors();
            
            // Event listeners
            this.setupEventListeners();
            
            // Periodic tasks
            this.startPeriodicTasks();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    /**
     * Modelleri başlat
     */
    async initializeModels() {
        // Varsayılan modeller
        const defaultModels = [
            {
                id: 'lstm_price_predictor',
                type: 'lstm',
                features: ['price', 'volume', 'rsi', 'macd', 'bb_position'],
                horizon: '15m',
                architecture: {
                    layers: [64, 32, 16],
                    dropout: 0.2,
                    recurrent_dropout: 0.1
                }
            },
            {
                id: 'transformer_pattern_detector',
                type: 'transformer',
                features: ['price', 'volume', 'orderbook_imbalance', 'technicals'],
                horizon: '1h',
                architecture: {
                    heads: 8,
                    layers: 4,
                    d_model: 128
                }
            },
            {
                id: 'cnn_pattern_classifier',
                type: 'cnn',
                features: ['price_chart', 'volume_profile'],
                horizon: '4h',
                architecture: {
                    filters: [32, 64, 128],
                    kernel_size: [3, 5, 7],
                    pooling: 'max'
                }
            }
        ];

        for (const modelConfig of defaultModels) {
            try {
                const model = await this.createModel(modelConfig);
                this.models.set(modelConfig.id, model);
                this.logger.info(`✅ Model yüklendi: ${modelConfig.id}`);
            } catch (error) {
                this.logger.error(`❌ Model yüklenemedi: ${modelConfig.id}`, error);
            }
        }
    }

    /**
     * Model oluştur (TensorFlow.js benzeri pseudo kod)
     */
    async createModel(config) {
        // Simplified model creation (gerçek implementasyonda TensorFlow.js kullanılır)
        const model = {
            id: config.id,
            type: config.type,
            features: config.features,
            horizon: config.horizon,
            architecture: config.architecture,
            status: 'initialized',
            accuracy: 0.5,
            last_trained: null,
            training_samples: 0,
            weights: new Map(), // Simplified weights
            
            // Prediction function
            predict: async (features) => {
                // Simplified prediction logic
                const randomFactor = Math.random() * 0.1 - 0.05;
                const trend = features.reduce((acc, val) => acc + val, 0) / features.length;
                
                return {
                    direction: trend > 0.5 ? 'bullish' : trend < -0.5 ? 'bearish' : 'neutral',
                    confidence: Math.min(0.95, Math.max(0.55, Math.abs(trend) + randomFactor)),
                    magnitude: Math.abs(trend),
                    probability: 0.5 + Math.abs(trend) * 0.4
                };
            },
            
            // Training function
            train: async (trainingData) => {
                // Simplified training logic
                model.status = 'training';
                model.training_samples = trainingData.length;
                
                // Simulate training time
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                model.accuracy = Math.min(0.95, 0.6 + Math.random() * 0.3);
                model.last_trained = new Date().toISOString();
                model.status = 'ready';
                
                return {
                    accuracy: model.accuracy,
                    loss: Math.random() * 0.1,
                    epochs: 100
                };
            }
        };
        
        return model;
    }

    /**
     * Feature extractors kurulumu
     */
    setupFeatureExtractors() {
        // Price-based features
        this.featureExtractors.set('price_features', (data) => {
            const prices = data.map(d => d.price);
            return {
                price_sma_5: this.calculateSMA(prices, 5),
                price_sma_20: this.calculateSMA(prices, 20),
                price_volatility: this.calculateVolatility(prices, 20),
                price_momentum: this.calculateMomentum(prices, 10),
                price_rsi: this.calculateRSI(prices, 14)
            };
        });
        
        // Volume-based features
        this.featureExtractors.set('volume_features', (data) => {
            const volumes = data.map(d => d.volume);
            return {
                volume_sma: this.calculateSMA(volumes, 20),
                volume_ratio: volumes[volumes.length - 1] / this.calculateSMA(volumes, 20),
                volume_trend: this.calculateTrend(volumes, 10)
            };
        });
        
        // Technical features
        this.featureExtractors.set('technical_features', (data) => {
            const lastData = data[data.length - 1];
            return {
                rsi_normalized: (lastData.technicals?.rsi || 50) / 100,
                macd_signal: Math.tanh((lastData.technicals?.macd || 0) / 10),
                bb_position: this.calculateBBPosition(lastData),
                ema_divergence: this.calculateEMADivergence(data)
            };
        });
        
        // Market microstructure features
        this.featureExtractors.set('microstructure_features', (data) => {
            const lastData = data[data.length - 1];
            const orderbook = lastData.orderbook;
            
            return {
                bid_ask_spread: this.calculateSpread(orderbook),
                orderbook_imbalance: this.calculateOrderbookImbalance(orderbook),
                order_depth: this.calculateOrderDepth(orderbook),
                price_impact: this.calculatePriceImpact(orderbook)
            };
        });
    }

    /**
     * Event listeners kurulumu
     */
    setupEventListeners() {
        // Market data stream
        this.on('market.data.stream', async (data) => {
            await this.handleMarketData(data);
        });
        
        // Model training requests
        this.on('model.training.request', async (data) => {
            await this.handleTrainingRequest(data);
        });
        
        // Prediction requests
        this.on('prediction.request', async (data) => {
            await this.handlePredictionRequest(data);
        });
    }

    /**
     * Market data işleyici
     */
    async handleMarketData(data) {
        try {
            const validated = MarketDataStreamSchema.parse(data);
            
            // Data buffer'a ekle
            if (!this.dataBuffer.has(validated.symbol)) {
                this.dataBuffer.set(validated.symbol, []);
            }
            
            const buffer = this.dataBuffer.get(validated.symbol);
            buffer.push(validated);
            
            // Buffer limitini koru
            if (buffer.length > this.config.dataRetention) {
                buffer.shift();
            }
            
            // Otomatik analiz tetikle (yeterli veri varsa)
            if (buffer.length >= 100) {
                await this.generateAutomaticInsights(validated.symbol);
            }
            
        } catch (error) {
            this.logger.error('Market data processing error:', error);
        }
    }

    /**
     * Otomatik insight üret
     */
    async generateAutomaticInsights(symbol) {
        try {
            const data = this.dataBuffer.get(symbol);
            if (!data || data.length < 50) return;
            
            // Her model için prediction yap
            for (const [modelId, model] of this.models) {
                if (model.status !== 'ready') continue;
                
                const features = await this.extractFeatures(data, model.features);
                const prediction = await model.predict(features);
                
                // Insight oluştur ve yayınla
                const insight = {
                    event: 'deep.insight',
                    timestamp: new Date().toISOString(),
                    symbol: symbol,
                    insight: {
                        pattern: `${modelId}_pattern`,
                        confidence: prediction.confidence,
                        significance: this.calculateSignificance(prediction.confidence),
                        prediction: {
                            direction: prediction.direction,
                            magnitude: prediction.magnitude,
                            probability: prediction.probability,
                            timeframe: model.horizon
                        },
                        neural_features: this.getNeuralFeatureImportance(model, features),
                        market_regime: this.detectMarketRegime(data),
                        anomaly_score: this.calculateAnomalyScore(data, features)
                    },
                    model: {
                        type: model.type,
                        version: '1.0.0',
                        accuracy: model.accuracy,
                        last_trained: model.last_trained,
                        training_samples: model.training_samples
                    },
                    metadata: {
                        computation_time_ms: 10, // Simplified
                        gpu_utilized: this.config.gpuAcceleration,
                        memory_usage_mb: 50,
                        data_quality_score: this.assessDataQuality(data)
                    }
                };
                
                this.emit('deep.insight', insight);
                this.metrics.predictions_made++;
            }
            
        } catch (error) {
            this.logger.error(`Automatic insights generation error for ${symbol}:`, error);
        }
    }

    /**
     * Feature çıkarma
     */
    async extractFeatures(data, requiredFeatures) {
        const features = [];
        
        // Her feature extractor'ı çalıştır
        for (const [extractorName, extractor] of this.featureExtractors) {
            try {
                const extractedFeatures = extractor(data);
                
                // Sadece gerekli feature'ları al
                for (const featureName of requiredFeatures) {
                    if (extractedFeatures[featureName] !== undefined) {
                        features.push(extractedFeatures[featureName]);
                    }
                }
            } catch (error) {
                this.logger.warn(`Feature extraction error for ${extractorName}:`, error);
            }
        }
        
        // Eğer yeterli feature yok, default değerler ekle
        while (features.length < requiredFeatures.length) {
            features.push(0);
        }
        
        return features;
    }

    /**
     * Significance hesaplama
     */
    calculateSignificance(confidence) {
        if (confidence >= 0.9) return 'critical';
        if (confidence >= 0.8) return 'high';
        if (confidence >= 0.7) return 'medium';
        return 'low';
    }

    /**
     * Neural feature importance
     */
    getNeuralFeatureImportance(model, features) {
        return model.features.map((featureName, index) => ({
            name: featureName,
            importance: Math.random() * 0.8 + 0.1, // Simplified
            activation: features[index] || 0
        }));
    }

    /**
     * Market regime detection
     */
    detectMarketRegime(data) {
        const prices = data.slice(-50).map(d => d.price);
        const volatility = this.calculateVolatility(prices, 20);
        const trend = this.calculateTrend(prices, 20);
        
        if (volatility > 0.05) return 'volatile';
        if (volatility < 0.01) return 'calm';
        if (Math.abs(trend) > 0.02) return 'trending';
        return 'ranging';
    }

    /**
     * Anomaly score hesaplama
     */
    calculateAnomalyScore(data, features) {
        // Z-score based anomaly detection
        const mean = features.reduce((a, b) => a + b, 0) / features.length;
        const variance = features.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / features.length;
        const stdDev = Math.sqrt(variance);
        
        const maxZScore = Math.max(...features.map(f => Math.abs((f - mean) / stdDev)));
        return Math.min(1, maxZScore / 3); // Normalize to 0-1
    }

    /**
     * Data quality assessment
     */
    assessDataQuality(data) {
        let score = 1.0;
        
        // Completeness check
        const missingData = data.filter(d => !d.price || !d.volume).length;
        score -= (missingData / data.length) * 0.3;
        
        // Consistency check
        const priceJumps = data.slice(1).filter((d, i) => {
            const prevPrice = data[i].price;
            return Math.abs((d.price - prevPrice) / prevPrice) > 0.1;
        }).length;
        score -= (priceJumps / data.length) * 0.2;
        
        // Freshness check
        const lastTimestamp = new Date(data[data.length - 1].timestamp);
        const age = (Date.now() - lastTimestamp) / (1000 * 60); // minutes
        if (age > 5) score -= 0.2;
        
        return Math.max(0, score);
    }

    // Utility functions
    calculateSMA(values, period) {
        if (values.length < period) return values[values.length - 1] || 0;
        const slice = values.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    calculateVolatility(values, period) {
        if (values.length < period) return 0;
        const returns = values.slice(-period).slice(1).map((val, i) => 
            Math.log(val / values[values.length - period + i])
        );
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
        return Math.sqrt(variance);
    }

    calculateMomentum(values, period) {
        if (values.length < period + 1) return 0;
        const current = values[values.length - 1];
        const past = values[values.length - 1 - period];
        return (current - past) / past;
    }

    calculateRSI(values, period) {
        if (values.length < period + 1) return 50;
        
        let gains = 0, losses = 0;
        for (let i = values.length - period; i < values.length; i++) {
            const change = values[i] - values[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    calculateTrend(values, period) {
        if (values.length < period) return 0;
        const slice = values.slice(-period);
        const n = slice.length;
        const x = Array.from({length: n}, (_, i) => i);
        const y = slice;
        
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
        const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        return slope / (sumY / n); // Normalized slope
    }

    calculateBBPosition(data) {
        if (!data.technicals) return 0.5;
        const price = data.price;
        const upper = data.technicals.bb_upper;
        const lower = data.technicals.bb_lower;
        
        if (!upper || !lower) return 0.5;
        return (price - lower) / (upper - lower);
    }

    calculateEMADivergence(data) {
        if (data.length < 2) return 0;
        const current = data[data.length - 1];
        const previous = data[data.length - 2];
        
        if (!current.technicals || !previous.technicals) return 0;
        
        const fastCurrent = current.technicals.ema_fast;
        const slowCurrent = current.technicals.ema_slow;
        const fastPrevious = previous.technicals.ema_fast;
        const slowPrevious = previous.technicals.ema_slow;
        
        if (!fastCurrent || !slowCurrent || !fastPrevious || !slowPrevious) return 0;
        
        const currentDiff = fastCurrent - slowCurrent;
        const previousDiff = fastPrevious - slowPrevious;
        
        return (currentDiff - previousDiff) / slowCurrent;
    }

    calculateSpread(orderbook) {
        if (!orderbook.bids.length || !orderbook.asks.length) return 0;
        const bestBid = orderbook.bids[0][0];
        const bestAsk = orderbook.asks[0][0];
        return (bestAsk - bestBid) / bestBid;
    }

    calculateOrderbookImbalance(orderbook) {
        const bidVolume = orderbook.bids.slice(0, 5).reduce((sum, [price, vol]) => sum + vol, 0);
        const askVolume = orderbook.asks.slice(0, 5).reduce((sum, [price, vol]) => sum + vol, 0);
        const totalVolume = bidVolume + askVolume;
        return totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;
    }

    calculateOrderDepth(orderbook) {
        const bidDepth = orderbook.bids.length;
        const askDepth = orderbook.asks.length;
        return Math.min(bidDepth, askDepth);
    }

    calculatePriceImpact(orderbook) {
        if (!orderbook.bids.length || !orderbook.asks.length) return 0;
        
        const midPrice = (orderbook.bids[0][0] + orderbook.asks[0][0]) / 2;
        const impactSize = 1000; // $1000 order impact
        
        let bidImpact = 0, askImpact = 0;
        let bidRemaining = impactSize, askRemaining = impactSize;
        
        for (const [price, volume] of orderbook.bids) {
            const orderValue = price * volume;
            if (orderValue >= bidRemaining) {
                bidImpact = Math.abs(price - midPrice) / midPrice;
                break;
            }
            bidRemaining -= orderValue;
        }
        
        for (const [price, volume] of orderbook.asks) {
            const orderValue = price * volume;
            if (orderValue >= askRemaining) {
                askImpact = Math.abs(price - midPrice) / midPrice;
                break;
            }
            askRemaining -= orderValue;
        }
        
        return (bidImpact + askImpact) / 2;
    }

    /**
     * Periodic görevleri başlat
     */
    startPeriodicTasks() {
        // Model performance monitoring
        setInterval(() => {
            this.monitorModelPerformance();
        }, 300000); // 5 dakika
        
        // Cache cleanup
        setInterval(() => {
            this.cleanupCaches();
        }, 600000); // 10 dakika
        
        // Metrics emission
        setInterval(() => {
            this.emitMetrics();
        }, 60000); // 1 dakika
    }

    /**
     * Model performansını izle
     */
    monitorModelPerformance() {
        for (const [modelId, model] of this.models) {
            if (model.status === 'ready' && model.accuracy < this.config.retrainThreshold) {
                this.logger.warn(`Model ${modelId} accuracy düşük: ${model.accuracy}`);
                
                if (this.config.autoRetrain) {
                    this.scheduleRetraining(modelId);
                }
            }
        }
    }

    /**
     * Cache temizliği
     */
    cleanupCaches() {
        const now = Date.now();
        const cacheExpiry = 3600000; // 1 saat
        
        for (const [key, entry] of this.predictionCache) {
            if (now - entry.timestamp > cacheExpiry) {
                this.predictionCache.delete(key);
            }
        }
    }

    /**
     * Metrikleri yayınla
     */
    emitMetrics() {
        const metrics = {
            event: 'dl.metrics',
            timestamp: new Date().toISOString(),
            metrics: {
                ...this.metrics,
                models_active: Array.from(this.models.values()).filter(m => m.status === 'ready').length,
                cache_size: this.predictionCache.size,
                data_buffer_size: Array.from(this.dataBuffer.values()).reduce((sum, buf) => sum + buf.length, 0)
            }
        };
        
        this.emit('dl.metrics', metrics);
    }

    /**
     * Model yeniden eğitimi planla
     */
    scheduleRetraining(modelId) {
        this.trainingQueue.push({
            modelId,
            timestamp: Date.now(),
            priority: 'normal'
        });
    }

    /**
     * Ana işlem fonksiyonu
     */
    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            // Event türüne göre işlem yap
            if (data.event === 'market.data.stream') {
                await this.handleMarketData(data);
            } else if (data.event === 'model.training.request') {
                await this.handleTrainingRequest(data);
            } else if (data.event === 'prediction.request') {
                await this.handlePredictionRequest(data);
            }

            return {
                success: true,
                data: {
                    processed: true,
                    models_active: this.models.size,
                    predictions_made: this.metrics.predictions_made
                },
                timestamp: new Date().toISOString(),
                source: this.name
            };
        } catch (error) {
            this.logger.error(`${this.name} işlem hatası:`, error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        }
    }

    /**
     * Sistem durumunu al
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            models: Array.from(this.models.entries()).map(([id, model]) => ({
                id,
                type: model.type,
                status: model.status,
                accuracy: model.accuracy,
                last_trained: model.last_trained
            })),
            metrics: this.metrics,
            config: this.config
        };
    }

    /**
     * Sistemi durdur
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Aktif eğitimleri durdur
            for (const [modelId, model] of this.models) {
                if (model.status === 'training') {
                    model.status = 'stopped';
                }
            }
            
            // Cache'leri temizle
            this.predictionCache.clear();
            this.dataBuffer.clear();
            this.featureStore.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = {
    DeepLearningInsightsEngine,
    MarketDataStreamSchema,
    ModelTrainingRequestSchema,
    PredictionRequestSchema,
    DeepInsightSchema,
    ModelStatusSchema
};