// technicalIndicatorsEngine.js
// Teknik göstergeleri hesaplayan ve cache/hata yönetimi içeren modül

const axios = require('axios');
const technicalindicators = require('technicalindicators');

// Basit cache yapısı
const cache = {};
const CACHE_DURATION_MS = 60 * 1000; // 1 dakika

async function getIndicators(symbol, interval) {
  const cacheKey = `${symbol}_${interval}`;
  const now = Date.now();

  // Cache kontrolü
  if (
    cache[cacheKey] &&
    now - cache[cacheKey].timestamp < CACHE_DURATION_MS
  ) {
    return cache[cacheKey].data;
  }

  try {
    // Binance OHLCV verisi çek
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=200`;
    const response = await axios.get(url);
    const ohlcv = response.data;

    // OHLCV'den close fiyatlarını çıkar
    const closes = ohlcv.map(c => parseFloat(c[4]));

    // EMA hesaplamaları
    const ema9 = technicalindicators.EMA.calculate({ period: 9, values: closes });
    const ema21 = technicalindicators.EMA.calculate({ period: 21, values: closes });
    const ema50 = technicalindicators.EMA.calculate({ period: 50, values: closes });
    const ema200 = technicalindicators.EMA.calculate({ period: 200, values: closes });

    // RSI hesapla
    const rsi14 = technicalindicators.RSI.calculate({ period: 14, values: closes });

    // MACD hesapla
    const macdArr = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    const lastMacd = macdArr.length ? macdArr[macdArr.length - 1] : { MACD: 0, signal: 0, histogram: 0 };

    // Bollinger Bands hesapla
    const bollingerArr = technicalindicators.BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes
    });
    const lastBollinger = bollingerArr.length ? bollingerArr[bollingerArr.length - 1] : { upper: 0, middle: 0, lower: 0 };

    // ATR hesapla
    const highs = ohlcv.map(c => parseFloat(c[2]));
    const lows = ohlcv.map(c => parseFloat(c[3]));
    const atr14 = technicalindicators.ATR.calculate({
      period: 14,
      high: highs,
      low: lows,
      close: closes
    });

    // VWAP hesapla (günlük)
    function calcVWAP(ohlcv) {
      let cumulativeTPV = 0;
      let cumulativeVolume = 0;
      for (const c of ohlcv) {
        const typicalPrice = (parseFloat(c[2]) + parseFloat(c[3]) + parseFloat(c[4])) / 3;
        const volume = parseFloat(c[5]);
        cumulativeTPV += typicalPrice * volume;
        cumulativeVolume += volume;
      }
      return cumulativeVolume ? cumulativeTPV / cumulativeVolume : 0.0;
    }
    const vwap = calcVWAP(ohlcv);

    // Son EMA değerlerini al (en güncel veri)
    const last = arr => arr.length ? arr[arr.length - 1] : 0.0;

    // Örnek çıktı
    const result = {
      symbol,
      interval,
      timestamp: now,
      indicators: {
        ema9: last(ema9),
        ema21: last(ema21),
        ema50: last(ema50),
        ema200: last(ema200),
        rsi14: last(rsi14),
        macd: {
          line: lastMacd.MACD || 0,
          signal: lastMacd.signal || 0,
          histogram: lastMacd.histogram || 0
        },
        bollinger: {
          upper: lastBollinger.upper || 0,
          middle: lastBollinger.middle || 0,
          lower: lastBollinger.lower || 0
        },
        atr14: last(atr14),
        vwap: vwap
      }
    };

    // Cache'e kaydet
    cache[cacheKey] = { timestamp: now, data: result };
    return result;
  } catch (err) {
    console.warn(`[technicalIndicatorsEngine] Hata:`, err.message);
    // Hata durumunda default değerler dön
    return {
      symbol,
      interval,
      timestamp: now,
      indicators: {},
      isValid: false
    };
  }
}

module.exports = { getIndicators }; 