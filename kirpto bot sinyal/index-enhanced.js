require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { logError, logEvent } = require('./logs/logger');
const readline = require('readline');
const { decrypt } = require('./modules/envSecure');

async function loadDecryptedEnv() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  const key = await ask('Şifre çözme anahtarını girin (hex): ');
  rl.close();

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.startsWith('enc:')) {
    process.env.TELEGRAM_BOT_TOKEN = decrypt(process.env.TELEGRAM_BOT_TOKEN.slice(4), key);
  }
  if (process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_CHAT_ID.startsWith('enc:')) {
    process.env.TELEGRAM_CHAT_ID = decrypt(process.env.TELEGRAM_CHAT_ID.slice(4), key);
  }
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_KEY.startsWith('enc:')) {
    process.env.BINANCE_API_KEY = decrypt(process.env.BINANCE_API_KEY.slice(4), key);
  }
  if (process.env.BINANCE_SECRET_KEY && process.env.BINANCE_SECRET_KEY.startsWith('enc:')) {
    process.env.BINANCE_SECRET_KEY = decrypt(process.env.BINANCE_SECRET_KEY.slice(4), key);
  }
  if (process.env.NEWS_API_KEY && process.env.NEWS_API_KEY.startsWith('enc:')) {
    process.env.NEWS_API_KEY = decrypt(process.env.NEWS_API_KEY.slice(4), key);
  }
  console.log('Environment decrypted successfully!');
}

loadDecryptedEnv().then(async () => {
  console.log('🚀 Starting Enhanced KriptoBot with Production UMF...');
  
  // Global position state
  global.ACTIVE_POSITION = {
    symbol: "NEARUSDT",
    type: "long",
    stopAbove: null,
    stopBelow: 2.71,
    openedAt: 2.85,
    leverage: 10,
  };

  // Import Enhanced UMF and supporting modules
  const EnhancedUMF = require("./modules/enhancedUMF");
  const { evaluateStrategies } = require("./modules/strategiesManager");
  const { recognizePosition } = require("./modules/aiPositionRecognizer");
  const { createPositionMessage } = require("./modules/aiPositionMsg");
  const { sendTelegramMessage } = require("./modules/sendTelegram");
  const { createStopMessage } = require("./modules/stopMsg");
  const { runNewsPipeline } = require("./modules/scheduler");

  // Initialize Enhanced UMF
  const umfConfig = {
    symbols: [global.ACTIVE_POSITION.symbol, "BTCUSDT", "ETHUSDT"],
    streams: ['kline_1m', 'kline_15m', 'kline_4h', 'kline_1d', 'trade', 'depth', 'ticker'],
    enableValidation: true,
    enableEnrichment: true,
    enableStorage: true,
    storageConfig: {
      baseDir: './data/enhanced-trading',
      enableCompression: true,
      rotationInterval: 3600000 // 1 hour
    }
  };

  console.log('📡 Initializing Enhanced UMF with config:', JSON.stringify(umfConfig, null, 2));
  
  const umf = new EnhancedUMF(umfConfig);
  
  // Market data state for strategies
  let latestMarketData = {};
  let enrichedDataBuffer = new Map(); // symbol -> latest enriched data
  
  // Enhanced UMF Event Handlers
  umf.on('kline', (data) => {
    const { symbol, timeframe } = data;
    
    // Update market data buffer for strategies
    if (!latestMarketData[symbol]) latestMarketData[symbol] = {};
    latestMarketData[symbol][timeframe] = {
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
      // Enhanced fields from UMF
      vwap: data.enriched?.vwap,
      volatility: data.enriched?.volatility,
      momentum: data.enriched?.momentum
    };
    
    logEvent(`📈 ${symbol} ${timeframe} - Close: ${data.close} (VWAP: ${data.enriched?.vwap?.toFixed(4) || 'N/A'})`);
  });

  umf.on('trade', (data) => {
    const { symbol } = data;
    
    // Store enriched trade data
    enrichedDataBuffer.set(symbol, {
      ...enrichedDataBuffer.get(symbol),
      lastTrade: data,
      microstructure: data.enriched?.microstructure,
      tca: data.enriched?.tca
    });
    
    logEvent(`💱 ${symbol} Trade - Price: ${data.price}, Size: ${data.quantity}, Impact: ${data.enriched?.microstructure?.priceImpact?.toFixed(6) || 'N/A'}`);
  });

  umf.on('depth', (data) => {
    const { symbol } = data;
    
    // Store enriched orderbook data
    enrichedDataBuffer.set(symbol, {
      ...enrichedDataBuffer.get(symbol),
      orderbook: data,
      depthMetrics: data.enriched?.microstructure
    });
    
    // Log significant depth events
    if (data.enriched?.microstructure?.orderFlowImbalance) {
      const imbalance = data.enriched.microstructure.orderFlowImbalance;
      if (Math.abs(imbalance) > 0.3) { // Significant imbalance
        logEvent(`⚖️ ${symbol} Orderbook Imbalance: ${(imbalance * 100).toFixed(1)}%`);
      }
    }
  });

  umf.on('error', (error) => {
    logError(error, 'Enhanced UMF Error');
  });

  umf.on('connected', () => {
    console.log('✅ Enhanced UMF connected successfully!');
    logEvent('Enhanced UMF connection established');
  });

  umf.on('disconnected', () => {
    console.log('⚠️ Enhanced UMF disconnected');
    logEvent('Enhanced UMF disconnected - attempting reconnect');
  });

  // Enhanced Strategy Evaluation with UMF Data
  async function evaluateEnhancedStrategies(symbol) {
    try {
      const candles = latestMarketData[symbol];
      const enrichedData = enrichedDataBuffer.get(symbol);
      
      if (!candles || Object.keys(candles).length === 0) {
        console.log(`⏳ Waiting for market data for ${symbol}...`);
        return;
      }

      // Call existing strategy manager with enhanced data context
      const context = {
        candles,
        enrichedData,
        position: global.ACTIVE_POSITION,
        timestamp: Date.now()
      };
      
      await evaluateStrategies(symbol, candles, (message, type) => {
        // Enhanced logging with enriched context
        const enrichedMessage = enrichedData ? 
          `${message} [Microstructure: ${JSON.stringify(enrichedData.microstructure || {})}]` : 
          message;
        logEvent(enrichedMessage, type);
      });
      
    } catch (error) {
      logError(error, `Enhanced strategy evaluation error for ${symbol}`);
    }
  }

  // Enhanced Position Recognition with UMF Features
  async function enhancedPositionRecognition(symbol) {
    try {
      const enrichedData = enrichedDataBuffer.get(symbol);
      
      if (enrichedData && enrichedData.lastTrade) {
        // Use enriched features for better position recognition
        const features = {
          price: enrichedData.lastTrade.price,
          volume: enrichedData.lastTrade.quantity,
          microstructure: enrichedData.microstructure,
          tca: enrichedData.tca
        };
        
        // TODO: Enhance aiPositionRecognizer to use these features
        const position = await recognizePosition(symbol, features);
        
        if (position) {
          const message = createPositionMessage(position);
          console.log('🧠 Enhanced AI Position:', message);
          // sendTelegramMessage(message);
          logEvent(message, "Enhanced AI Position Detected");
        }
      }
    } catch (error) {
      logError(error, `Enhanced position recognition error for ${symbol}`);
    }
  }

  // Error handling
  process.on('uncaughtException', (err) => {
    logError(err, "uncaughtException");
  });

  process.on('unhandledRejection', (reason, promise) => {
    logError(reason, "unhandledRejection");
  });

  // Start Enhanced UMF
  console.log('🔗 Starting Enhanced UMF connection...');
  await umf.start();

  // Initial enhanced strategy run after connection
  setTimeout(async () => {
    console.log('🎯 Running initial enhanced strategy evaluation...');
    for (const symbol of umfConfig.symbols) {
      await evaluateEnhancedStrategies(symbol);
      await enhancedPositionRecognition(symbol);
    }
  }, 5000); // Wait 5 seconds for initial data

  // Enhanced main loop with multiple symbols
  const STRATEGY_INTERVAL = 30000; // 30 seconds
  setInterval(async () => {
    for (const symbol of umfConfig.symbols) {
      await evaluateEnhancedStrategies(symbol);
      await enhancedPositionRecognition(symbol);
    }
  }, STRATEGY_INTERVAL);

  console.log(`✅ Enhanced KriptoBot started! Monitoring ${umfConfig.symbols.length} symbols with ${umfConfig.streams.length} data streams.`);
  console.log(`📊 Strategy evaluation interval: ${STRATEGY_INTERVAL/1000}s`);
  console.log(`📡 Enhanced UMF features: Validation ✅, Enrichment ✅, Storage ✅`);

}).catch(error => {
  console.error('❌ Failed to start Enhanced KriptoBot:', error);
  logError(error, 'Startup Error');
});
