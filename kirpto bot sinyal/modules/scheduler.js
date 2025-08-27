// scheduler.js
// Tüm haber sistemi modüllerini otomatik olarak çalıştıran zamanlayıcı

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { fetchAndClassifyNews } = require('./newsFetcher');
const { analyzeSentiment } = require('./newsSentimentAnalyzer');
const { routeNewsImpact } = require('./newsReactionRouter');


const LOG_FILE = path.join(__dirname, '../logs/news_pipeline.log');
const LIMIT_FILE = path.join(__dirname, '../logs/news_api_limit.json');
const DAILY_LIMIT = 180;
const LIMIT_WARN_THRESHOLD = 160;

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getLimitState() {
  try {
    if (fs.existsSync(LIMIT_FILE)) {
      return JSON.parse(fs.readFileSync(LIMIT_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function updateLimitState() {
  const state = getLimitState();
  const key = getTodayKey();
  if (!state[key]) state[key] = 0;
  state[key]++;
  // Temizlik: eski günleri sil
  for (const k of Object.keys(state)) {
    if (k !== key) delete state[k];
  }
  fs.writeFileSync(LIMIT_FILE, JSON.stringify(state), 'utf8');
  return state[key];
}

function appendLog(message) {
  const logMsg = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logMsg, 'utf8');
}


async function runNewsPipeline() {
  try {
    // API limit kontrolü
    const todayCount = updateLimitState();
    if (todayCount >= LIMIT_WARN_THRESHOLD && todayCount < DAILY_LIMIT) {
      const warnMsg = `[API LIMIT] Bugünkü istek sayısı: ${todayCount} / ${DAILY_LIMIT}`;
      console.warn(warnMsg);
      appendLog(warnMsg);
    }
    if (todayCount >= DAILY_LIMIT) {
      const stopMsg = `[API LIMIT] GÜNLÜK LİMİT AŞILDI! (${todayCount} / ${DAILY_LIMIT})`; 
      console.error(stopMsg);
      appendLog(stopMsg);
      return;
    }
    const newsBatch = await fetchAndClassifyNews();
    for (const news of newsBatch) {
      const sentiment = analyzeSentiment(news.title, news.summary);
      const route = routeNewsImpact(news, sentiment);
      // Log hem dosyaya hem konsola
      const logData = `News: ${news.title}\nSentiment: ${JSON.stringify(sentiment)}\nRoute: ${JSON.stringify(route)}\n`;
      console.log('\n[NEWS PIPELINE]');
      console.log(logData);
      appendLog(logData);
    }
  } catch (e) {
    const errMsg = `[scheduler] Pipeline error: ${e.message}`;
    console.warn(errMsg);
    appendLog(errMsg);
  }
}

// Her 10 dakikada bir çalışacak şekilde ayarlandı (API limiti için güvenli)
cron.schedule('*/10 * * * *', runNewsPipeline);

// İlk başlatmada da çalıştır
runNewsPipeline();

module.exports = { runNewsPipeline };
