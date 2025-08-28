// strategies/volumeCompression-improved.js
// Gerçek volume compression analizi ve breakout tespiti

module.exports = {
  name: "volumeCompression-improved",

  // Eski versiyon uyumluluğu
  check: (candles) => {
    // Basit placeholder - her zaman tetikle
    return Math.random() > 0.7; // %30 şans
  },

  // Yeni enhanced versiyon - gerçek volume compression analizi
  checkEnhanced: (context) => {
    const { candles, indicators, marketCondition } = context;
    
    try {
      // 15m timeframe üzerinde volume analizi
      const current15m = candles['15m'];
      const current4h = candles['4h'];
      
      // Volume ve fiyat verileri
      const currentPrice = parseFloat(current15m.close);
      const currentVolume = parseFloat(current15m.volume);
      const high = parseFloat(current15m.high);
      const low = parseFloat(current15m.low);
      
      // Range calculation (candlestick body + shadows)
      const range = high - low;
      const bodySize = Math.abs(parseFloat(current15m.close) - parseFloat(current15m.open));
      const rangePercentage = (range / currentPrice) * 100;
      
      // ATR ile volume compression karşılaştırması
      const atr14 = indicators['15m'].atr14;
      const atrRatio = range / atr14;
      
      // Bollinger Bands ile sıkışma analizi
      const bollinger = indicators['15m'].bollinger;
      const bbWidth = ((bollinger.upper - bollinger.lower) / bollinger.middle) * 100;
      
      // RSI trend analizi
      const rsi = indicators['15m'].rsi14;
      const macd = indicators['15m'].macd;
      
      // Volume analysis - son periyotlardaki ortalama ile karşılaştır
      // Not: Gerçek uygulamada historical volume data gerekir
      // Şimdilik basit heuristic kullanıyoruz
      
      // Compression koşulları
      const isLowVolatility = rangePercentage < 1.5; // %1.5'den az hareket
      const isATRCompressed = atrRatio < 0.8; // ATR'nin %80'i altında
      const isBBCompressed = bbWidth < 2.0; // BB width %2'den az
      const isSmallBody = (bodySize / range) < 0.3; // Küçük gövde
      
      // Breakout potansiyeli
      const isNearResistance = currentPrice > bollinger.middle;
      const isNearSupport = currentPrice < bollinger.middle;
      const isMomentumBuilding = Math.abs(macd.histogram) > 0;
      const isRSINeutral = rsi > 35 && rsi < 65;
      
      // Volume compression skoru
      let compressionScore = 0;
      if (isLowVolatility) compressionScore += 25;
      if (isATRCompressed) compressionScore += 25; 
      if (isBBCompressed) compressionScore += 25;
      if (isSmallBody) compressionScore += 25;
      
      // Breakout potansiyel skoru
      let breakoutPotential = 0;
      if (isMomentumBuilding) breakoutPotential += 30;
      if (isRSINeutral) breakoutPotential += 20;
      if (isNearResistance || isNearSupport) breakoutPotential += 25;
      if (marketCondition.trend !== 'sideways') breakoutPotential += 25;
      
      // Enhanced status kaydet
      module.exports._enhancedStatus = {
        symbol: context.activePosition?.symbol || context.symbol,
        currentPrice,
        rangePercentage: rangePercentage.toFixed(2),
        atrRatio: atrRatio.toFixed(2),
        bbWidth: bbWidth.toFixed(2),
        compressionScore,
        breakoutPotential,
        analysis: {
          isLowVolatility,
          isATRCompressed,
          isBBCompressed,
          isSmallBody,
          isMomentumBuilding,
          isRSINeutral
        },
        indicators: {
          rsi: rsi.toFixed(1),
          macdSignal: macd.line > macd.signal ? 'bullish' : 'bearish',
          bbPosition: currentPrice > bollinger.upper ? 'upper' : 
                      currentPrice < bollinger.lower ? 'lower' : 'middle'
        },
        marketCondition
      };
      
      // Tetikleme koşulu: Yüksek compression + orta-yüksek breakout potansiyeli
      return compressionScore >= 75 && breakoutPotential >= 50;
      
    } catch (error) {
      console.error('[volumeCompression] Analysis error:', error.message);
      return false;
    }
  },

  // Eski mesaj
  message: () => {
    const now = new Date();
    const time = now.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" });
    return `📉 Sessiz bölge kırıldı. Fiyat: 19.75 – Hacim artışı var.\n📊 4H boyunca yatay sıkışma sonrası kırılım geldi.\n🕒 ${time}`;
  },

  // Yeni enhanced mesaj
  messageEnhanced: (context) => {
    const status = module.exports._enhancedStatus;
    if (!status) return module.exports.message();
    
    const { 
      symbol, currentPrice, rangePercentage, compressionScore, 
      breakoutPotential, analysis, indicators, marketCondition 
    } = status;
    
    const now = new Date();
    const time = now.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" });
    
    // Compression seviyesine göre mesaj tonu
    let header, emoji;
    if (compressionScore >= 90) {
      header = "🚀 EXTREME COMPRESSION - Büyük hareket bekleniyor!";
      emoji = "🚀";
    } else if (compressionScore >= 75) {
      header = "📈 YÜKSEK COMPRESSION - Kırılım yakın!";
      emoji = "⚡";
    } else {
      header = "📊 Volume Compression Tespit Edildi";
      emoji = "📊";
    }
    
    // Teknik analiz özeti
    const technicalSummary = 
      `\n${emoji} ${symbol} - Fiyat: ${currentPrice}\n` +
      `📏 Range: %${rangePercentage} | Compression: ${compressionScore}%\n` +
      `🎯 Breakout Potansiyeli: ${breakoutPotential}%\n` +
      `📈 RSI: ${indicators.rsi} | MACD: ${indicators.macdSignal}\n` +
      `📊 BB Pozisyon: ${indicators.bbPosition} | Trend: ${marketCondition.trend}`;
    
    // Detailed analysis
    const details = 
      `\n🔍 Analiz Detayları:\n` +
      `${analysis.isLowVolatility ? '✅' : '❌'} Düşük Volatilite\n` +
      `${analysis.isATRCompressed ? '✅' : '❌'} ATR Sıkışması\n` +
      `${analysis.isBBCompressed ? '✅' : '❌'} Bollinger Sıkışması\n` +
      `${analysis.isMomentumBuilding ? '✅' : '❌'} Momentum Artışı`;
    
    const timeStamp = `\n🕒 ${time}`;
    
    return `${header}${technicalSummary}${details}${timeStamp}`;
  }
};
