const { getIndicators } = require('./technicalIndicatorsEngine');

(async () => {
  const symbol = 'BTCUSDT';
  const interval = '5m';
  const result = await getIndicators(symbol, interval);
  console.log('Gelen veri:', JSON.stringify(result, null, 2));

  if (!result.indicators) {
    console.error('HATA: indicators alanı yok!');
    process.exit(1);
  }
  if (typeof result.indicators.ema21 === 'undefined') {
    console.error('HATA: EMA21 hesaplanamadı!');
    process.exit(1);
  }
  if (typeof result.indicators.rsi14 === 'undefined') {
    console.error('HATA: RSI14 hesaplanamadı!');
    process.exit(1);
  }
  if (typeof result.indicators.macd !== 'object') {
    console.error('HATA: MACD hesaplanamadı!');
    process.exit(1);
  }
  if (typeof result.indicators.bollinger !== 'object') {
    console.error('HATA: Bollinger hesaplanamadı!');
    process.exit(1);
  }
  if (typeof result.indicators.atr14 === 'undefined') {
    console.error('HATA: ATR14 hesaplanamadı!');
    process.exit(1);
  }
  if (typeof result.indicators.vwap === 'undefined') {
    console.error('HATA: VWAP hesaplanamadı!');
    process.exit(1);
  }
  console.log('Tüm göstergeler başarıyla hesaplandı!');
  process.exit(0);
})(); 