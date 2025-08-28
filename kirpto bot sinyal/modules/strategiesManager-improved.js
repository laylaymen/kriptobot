// strategiesManager-improved.js
// Geliştirilmiş strateji yöneticisi - Technical indicators entegrasyonu ile

const fs = require('fs');
const path = require('path');
const { getIndicators } = require('./technicalIndicatorsEngine');
const { sendMessageIfAllowed } = require('./messageManager');

// Strateji konfigürasyonu yükle
let strategiesConfig = {};
try {
  const configPath = path.join(__dirname, '../strategies/config.json');
  strategiesConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.warn('[strategiesManager] Config yüklenemedi:', err.message);
}

// Mevcut strategy dosyalarını yükle
const strategiesDir = path.join(__dirname, '../strategies');
const strategies = new Map();

function loadStrategies() {
  try {
    const files = fs.readdirSync(strategiesDir);
    
    for (const file of files) {
      if (file.endsWith('.js') && file !== 'config.json') {
        const strategyName = file.replace('.js', '');
        const strategyPath = path.join(strategiesDir, file);
        
        // Cache'i temizle ve yeniden yükle
        delete require.cache[require.resolve(strategyPath)];
        const strategy = require(strategyPath);
        
        strategies.set(strategyName, strategy);
      }
    }
    
    console.log(`[strategiesManager] ${strategies.size} strateji yüklendi`);
  } catch (err) {
    console.error('[strategiesManager] Strateji yükleme hatası:', err.message);
  }
}

// İlk yükleme
loadStrategies();

// Market durumu analizi
function analyzeMarketCondition(indicators, candles) {
  const { ema9, ema21, ema50, ema200, rsi14, macd } = indicators;
  const currentPrice = parseFloat(candles['15m'].close);
  
  // Trend analizi
  let trend = 'sideways';
  if (ema9 > ema21 && ema21 > ema50) {
    trend = 'bullish';
  } else if (ema9 < ema21 && ema21 < ema50) {
    trend = 'bearish';
  }
  
  // Momentum analizi
  let momentum = 'neutral';
  if (rsi14 > 70) {
    momentum = 'overbought';
  } else if (rsi14 < 30) {
    momentum = 'oversold';
  } else if (macd.line > macd.signal && macd.histogram > 0) {
    momentum = 'bullish';
  } else if (macd.line < macd.signal && macd.histogram < 0) {
    momentum = 'bearish';
  }
  
  // Volatilite analizi
  const volatility = indicators.atr14 / currentPrice * 100; // ATR/Price ratio
  let volatilityLevel = 'normal';
  if (volatility > 3) {
    volatilityLevel = 'high';
  } else if (volatility < 1) {
    volatilityLevel = 'low';
  }
  
  return {
    trend,
    momentum,
    volatilityLevel,
    rsi: rsi14,
    currentPrice,
    emaAlignment: ema9 > ema21 && ema21 > ema50,
    macdSignal: macd.line > macd.signal ? 'bullish' : 'bearish'
  };
}

// Geliştirilmiş strateji değerlendirme fonksiyonu
async function evaluateStrategies(symbol, candles, logEvent) {
  try {
    // Technical indicators al
    const indicators15m = await getIndicators(symbol, '15m');
    const indicators4h = await getIndicators(symbol, '4h');
    const indicators1d = await getIndicators(symbol, '1d');
    
    if (!indicators15m.indicators || !indicators4h.indicators || !indicators1d.indicators) {
      console.warn('[strategiesManager] Technical indicators alınamadı');
      return;
    }
    
    // Market analizi yap
    const marketCondition = analyzeMarketCondition(indicators15m.indicators, candles);
    
    // Enhanced context objesi oluştur
    const enhancedContext = {
      symbol,
      candles,
      indicators: {
        '15m': indicators15m.indicators,
        '4h': indicators4h.indicators,
        '1d': indicators1d.indicators
      },
      marketCondition,
      timestamp: Date.now(),
      activePosition: global.ACTIVE_POSITION
    };
    
    // Her stratejiyi değerlendir
    for (const [strategyName, strategy] of strategies) {
      try {
        // Config kontrolü
        const config = strategiesConfig[strategyName];
        if (!config || !config.enabled) {
          continue;
        }
        
        // Strateji kontrolü yap
        let shouldTrigger = false;
        
        if (strategy.checkEnhanced && typeof strategy.checkEnhanced === 'function') {
          // Yeni enhanced kontrol fonksiyonu varsa onu kullan
          shouldTrigger = strategy.checkEnhanced(enhancedContext);
        } else if (strategy.check && typeof strategy.check === 'function') {
          // Eski kontrol fonksiyonunu kullan
          shouldTrigger = strategy.check(candles);
        }
        
        if (shouldTrigger) {
          // Mesaj oluştur
          let message = '';
          
          if (strategy.messageEnhanced && typeof strategy.messageEnhanced === 'function') {
            message = strategy.messageEnhanced(enhancedContext);
          } else if (strategy.message && typeof strategy.message === 'function') {
            message = strategy.message(parseFloat(candles['15m'].close));
          } else {
            message = `🔔 ${strategyName} stratejisi tetiklendi - ${symbol}`;
          }
          
          // Mesajı gönder ve logla
          await sendMessageIfAllowed(message);
          logEvent(`[${strategyName}] ${message}`, 'Strategy Triggered');
          
          console.log(`✅ [${strategyName}] Tetiklendi: ${symbol}`);
          console.log(`📊 Market: ${marketCondition.trend} trend, ${marketCondition.momentum} momentum`);
          console.log(`📈 RSI: ${marketCondition.rsi.toFixed(2)}, Price: ${marketCondition.currentPrice}`);
        }
        
      } catch (strategyError) {
        console.error(`[strategiesManager] ${strategyName} hatası:`, strategyError.message);
        logEvent(`[${strategyName}] Hata: ${strategyError.message}`, 'Strategy Error');
      }
    }
    
  } catch (err) {
    console.error('[strategiesManager] Genel hata:', err.message);
    logEvent(`Strateji değerlendirme hatası: ${err.message}`, 'System Error');
  }
}

// Strateji istatistikleri
function getStrategyStats() {
  const stats = {
    totalStrategies: strategies.size,
    enabledStrategies: 0,
    loadedStrategies: Array.from(strategies.keys())
  };
  
  for (const [name, config] of Object.entries(strategiesConfig)) {
    if (config.enabled) {
      stats.enabledStrategies++;
    }
  }
  
  return stats;
}

// Hot reload - strateji dosyalarını yeniden yükle
function reloadStrategies() {
  loadStrategies();
  
  // Config'i de yeniden yükle
  try {
    const configPath = path.join(__dirname, '../strategies/config.json');
    delete require.cache[require.resolve(configPath)];
    strategiesConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.warn('[strategiesManager] Config reload hatası:', err.message);
  }
  
  console.log('[strategiesManager] Stratejiler yeniden yüklendi');
}

module.exports = {
  evaluateStrategies,
  getStrategyStats,
  reloadStrategies,
  analyzeMarketCondition
};
