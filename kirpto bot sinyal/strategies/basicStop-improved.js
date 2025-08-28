// strategies/basicStop-improved.js
// Geliştirilmiş stop-loss stratejisi - Technical indicators ile

module.exports = {
  name: "basicStop-improved",

  // Eski versiyon uyumluluğu için
  check: (candles) => {
    const stopAbove = global.ACTIVE_POSITION?.stopAbove;
    const stopBelow = global.ACTIVE_POSITION?.stopBelow;
    const type = global.ACTIVE_POSITION?.type;

    const c15 = parseFloat(candles["15m"].close);
    const c4h = parseFloat(candles["4h"].close);
    const c1d = parseFloat(candles["1d"].close);

    let condition15, condition4h, condition1d;

    if (type === "short" && stopAbove !== null) {
      condition15 = c15 > stopAbove;
      condition4h = c4h > stopAbove;
      condition1d = c1d > stopAbove;
    }

    if (type === "long" && stopBelow !== null) {
      condition15 = c15 < stopBelow;
      condition4h = c4h < stopBelow;
      condition1d = c1d < stopBelow;
    }

    const metCount = [condition15, condition4h, condition1d].filter(Boolean).length;
    return metCount > 0;
  },

  // Yeni enhanced versiyon
  checkEnhanced: (context) => {
    const { candles, indicators, marketCondition, activePosition } = context;
    
    if (!activePosition) return false;
    
    const stopAbove = activePosition.stopAbove;
    const stopBelow = activePosition.stopBelow;
    const type = activePosition.type;
    const openedAt = activePosition.openedAt;
    
    const c15 = parseFloat(candles["15m"].close);
    const c4h = parseFloat(candles["4h"].close);
    const c1d = parseFloat(candles["1d"].close);
    
    // RSI ve MACD ile stop sinyali güçlendirmesi
    const rsi15m = indicators['15m'].rsi14;
    const macd15m = indicators['15m'].macd;
    const ema9 = indicators['15m'].ema9;
    const ema21 = indicators['15m'].ema21;
    
    let condition15, condition4h, condition1d, direction, level;
    let riskLevel = 'normal';
    
    if (type === "short" && stopAbove !== null) {
      level = stopAbove;
      condition15 = c15 > stopAbove;
      condition4h = c4h > stopAbove;
      condition1d = c1d > stopAbove;
      direction = "üstünde";
      
      // Short pozisyon için risk faktörleri
      if (rsi15m < 30 && macd15m.line > macd15m.signal) {
        riskLevel = 'high'; // Oversold + MACD bullish = risk artışı
      }
      if (ema9 > ema21 && c15 > openedAt * 1.02) {
        riskLevel = 'critical'; // Trend değişimi + %2+ loss
      }
    }

    if (type === "long" && stopBelow !== null) {
      level = stopBelow;
      condition15 = c15 < stopBelow;
      condition4h = c4h < stopBelow;
      condition1d = c1d < stopBelow;
      direction = "altında";
      
      // Long pozisyon için risk faktörleri
      if (rsi15m > 70 && macd15m.line < macd15m.signal) {
        riskLevel = 'high'; // Overbought + MACD bearish = risk artışı
      }
      if (ema9 < ema21 && c15 < openedAt * 0.98) {
        riskLevel = 'critical'; // Trend değişimi + %2+ loss
      }
    }

    const metCount = [condition15, condition4h, condition1d].filter(Boolean).length;
    
    // Enhanced context'e bilgileri kaydet
    const status = {
      "15m": condition15 ? "✅" : "❌",
      "4h": condition4h ? "✅" : "❌", 
      "1d": condition1d ? "✅" : "❌",
    };

    module.exports._enhancedStatus = {
      status,
      level,
      direction,
      metCount,
      riskLevel,
      current: { c15, c4h, c1d },
      symbol: activePosition.symbol || "COIN",
      marketCondition,
      indicators: {
        rsi: rsi15m,
        macdSignal: macd15m.line > macd15m.signal ? 'bullish' : 'bearish',
        emaAlignment: ema9 > ema21 ? 'bullish' : 'bearish'
      }
    };

    // Risk seviyesine göre tetikleme
    if (riskLevel === 'critical') {
      return metCount > 0; // Critical durumda tek timeframe bile yeterli
    } else if (riskLevel === 'high') {
      return metCount >= 2; // High risk'te 2 timeframe gerekli
    } else {
      return metCount >= 2; // Normal durumda 2 timeframe gerekli
    }
  },

  // Eski mesaj fonksiyonu
  message: (price) => {
    const { status, level, direction, metCount, current, symbol } = module.exports._status || {};
    
    const header = metCount === 3 ? "🛑 KESİN STOP" : metCount === 2 ? "⚠️ STOP yaklaşıyor" : "🔔 DİKKAT";
    
    return (
      `${header}\n${symbol} pozisyonu ${level} ${direction}.\n` +
      `📊 15M: ${current?.c15} → ${status?.["15m"]}\n` +
      `🕓 4H: ${current?.c4h} → ${status?.["4h"]}\n` +
      `📅 1D: ${current?.c1d} → ${status?.["1d"]}`
    );
  },

  // Yeni enhanced mesaj fonksiyonu
  messageEnhanced: (context) => {
    const enhanced = module.exports._enhancedStatus;
    if (!enhanced) return module.exports.message();
    
    const { status, level, direction, metCount, riskLevel, current, symbol, marketCondition, indicators } = enhanced;
    
    // Risk seviyesine göre emoji ve header
    let header, riskEmoji;
    if (riskLevel === 'critical') {
      header = "🚨 KRİTİK STOP - HEMEN KAPAT!";
      riskEmoji = "🚨";
    } else if (riskLevel === 'high') {
      header = metCount >= 2 ? "🛑 YÜKSEK RİSK STOP" : "⚠️ YÜKSEK RİSK - DİKKAT";
      riskEmoji = "⚠️";
    } else {
      header = metCount === 3 ? "🛑 KESİN STOP" : metCount === 2 ? "⚠️ STOP yaklaşıyor" : "🔔 DİKKAT";
      riskEmoji = "📊";
    }
    
    const timeframeStatus = 
      `📊 15M: ${current.c15} → ${status["15m"]}\n` +
      `🕓 4H: ${current.c4h} → ${status["4h"]}\n` +
      `📅 1D: ${current.c1d} → ${status["1d"]}`;
    
    const technicalInfo =
      `\n📈 RSI: ${indicators.rsi.toFixed(1)} | MACD: ${indicators.macdSignal}\n` +
      `📊 Trend: ${marketCondition.trend} | EMA: ${indicators.emaAlignment}\n` +
      `${riskEmoji} Risk: ${riskLevel.toUpperCase()}`;
    
    return `${header}\n${symbol} pozisyonu ${level} ${direction}.\n${timeframeStatus}${technicalInfo}`;
  }
};
