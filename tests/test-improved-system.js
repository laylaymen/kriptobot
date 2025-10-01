// test-improved-system.js
// Geliştirilmiş sistem test scripti

// require('dotenv').config(); // Skip dotenv for now

// Global test position
global.ACTIVE_POSITION = {
  symbol: "BTCUSDT",
  type: "long",
  stopAbove: null,
  stopBelow: 43000,
  openedAt: 45000,
  leverage: 10
};

const { evaluateStrategies, getStrategyStats, analyzeMarketCondition } = require('./kirpto bot sinyal/modules/strategiesManager-improved');
const { fetchMultiTimeframe } = require('./kirpto bot sinyal/modules/dataFetcher');
const { getIndicators } = require('./kirpto bot sinyal/modules/technicalIndicatorsEngine');

console.log('🚀 Geliştirilmiş Sistem Test Başlıyor...\n');

async function testImprovedSystem() {
  try {
    // 1. Strategy stats
    const stats = getStrategyStats();
    console.log('📊 Strateji İstatistikleri:');
    console.log(`   Total: ${stats.totalStrategies}`);
    console.log(`   Enabled: ${stats.enabledStrategies}`);
    console.log(`   Loaded: ${stats.loadedStrategies.join(', ')}\n`);
    
    // 2. Test position bilgisi
    console.log('📍 Test Pozisyonu:');
    console.log(`   ${global.ACTIVE_POSITION.symbol} ${global.ACTIVE_POSITION.type.toUpperCase()}`);
    console.log(`   Entry: ${global.ACTIVE_POSITION.openedAt}, Stop: ${global.ACTIVE_POSITION.stopBelow}\n`);
    
    // 3. Market data al
    console.log('📈 Market verisi alınıyor...');
    const symbol = global.ACTIVE_POSITION.symbol;
    const candles = await fetchMultiTimeframe(symbol);
    
    console.log(`   ${symbol} 15m: ${candles['15m'].close}`);
    console.log(`   ${symbol} 4h: ${candles['4h'].close}`);
    console.log(`   ${symbol} 1d: ${candles['1d'].close}\n`);
    
    // 4. Technical indicators
    console.log('⚡ Technical indicators hesaplanıyor...');
    const indicators = await getIndicators(symbol, '15m');
    
    if (indicators.indicators) {
      const ind = indicators.indicators;
      console.log(`   RSI: ${ind.rsi14?.toFixed(2) || 'N/A'}`);
      console.log(`   EMA9: ${ind.ema9?.toFixed(2) || 'N/A'}`);
      console.log(`   EMA21: ${ind.ema21?.toFixed(2) || 'N/A'}`);
      console.log(`   MACD: ${ind.macd?.line?.toFixed(4) || 'N/A'} / ${ind.macd?.signal?.toFixed(4) || 'N/A'}`);
      console.log(`   ATR: ${ind.atr14?.toFixed(2) || 'N/A'}`);
      console.log(`   VWAP: ${ind.vwap?.toFixed(2) || 'N/A'}\n`);
    }
    
    // 5. Market condition analizi
    console.log('🧠 Market analizi yapılıyor...');
    if (indicators.indicators) {
      const marketCondition = analyzeMarketCondition(indicators.indicators, candles);
      console.log(`   Trend: ${marketCondition.trend}`);
      console.log(`   Momentum: ${marketCondition.momentum}`);
      console.log(`   Volatility: ${marketCondition.volatilityLevel}`);
      console.log(`   EMA Alignment: ${marketCondition.emaAlignment ? 'Bullish' : 'Bearish'}`);
      console.log(`   MACD Signal: ${marketCondition.macdSignal}\n`);
    }
    
    // 6. Stratejileri değerlendir
    console.log('🎯 Stratejiler değerlendiriliyor...');
    
    // Dummy log function
    const logEvent = (message, type) => {
      console.log(`   [LOG] ${type}: ${message}`);
    };
    
    await evaluateStrategies(symbol, candles, logEvent);
    
    console.log('\n✅ Test tamamlandı!');
    
  } catch (error) {
    console.error('❌ Test hatası:', error.message);
    console.error(error.stack);
  }
}

// Test çalıştır
testImprovedSystem();
