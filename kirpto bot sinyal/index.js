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
  console.log('Çözülen NEWS_API_KEY:', process.env.NEWS_API_KEY);
  console.log('Çözülen TELEGRAM_CHAT_ID:', process.env.TELEGRAM_CHAT_ID);
  console.log('Çözülen TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN);
  console.log('Çözülen BINANCE_API_KEY:', process.env.BINANCE_API_KEY);
  console.log('Çözülen BINANCE_SECRET_KEY:', process.env.BINANCE_SECRET_KEY);
}

loadDecryptedEnv().then(() => {
  global.ACTIVE_POSITION = {
    symbol: "NEARUSDT",
    type: "long",
    stopAbove: null,
    stopBelow: 2.71,
    openedAt: 2.85,
    leverage: 10,
  };

  const { fetchMultiTimeframe } = require("./modules/dataFetcher");
  const { evaluateStrategies } = require("./modules/strategiesManager");
  const { recognizePosition } = require("./modules/aiPositionRecognizer");
  const { createPositionMessage } = require("./modules/aiPositionMsg");
  const { sendTelegramMessage } = require("./modules/sendTelegram");
  const { createStopMessage } = require("./modules/stopMsg");

  const stoppedPosition = {
    coin: "AVAXUSDT",
    type: "short",
  };

  const tfSummary = "15M: üstü, 4H: altı, 1D: üstü";

  const stopMessage = createStopMessage(stoppedPosition, tfSummary);
  console.log(stopMessage);
  // sendTelegramMessage(stopMessage);
  logEvent(stopMessage, "STOP mesajı gönderildi");
  recognizePosition("AVAXUSDT");

  const testPos = {
    coin: "AVAXUSDT",
    type: "short",
    entry: 19.85,
    stop: 20.2,
    leverage: 5,
  };

  const message = createPositionMessage(testPos);
  console.log(message);
  // sendTelegramMessage(message);
  logEvent(message, "Pozisyon mesajı gönderildi");

  process.on('uncaughtException', (err) => {
    logError(err, "uncaughtException");
  });

  process.on('unhandledRejection', (reason, promise) => {
    logError(reason, "unhandledRejection");
  });

  (async () => {
    const symbol = "AVAXUSDT"; // test coini
    const candles = await fetchMultiTimeframe(symbol); // mum verileri
    await evaluateStrategies(symbol, candles, logEvent); // stratejileri çalıştır
  })();

  setInterval(async () => {
    try {
      const symbol = global.ACTIVE_POSITION.symbol;
      const candles = await fetchMultiTimeframe(symbol);
      await evaluateStrategies(symbol, candles, logEvent);
    } catch (err) {
      logError(err, "Ana döngüde hata");
    }
  }, 30000); // 30 saniyede bir çalışır
});
