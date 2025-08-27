// test_news_pipeline.js
// Basit test: pipeline zincirinin çıktısını ve hata yönetimini test eder

const { fetchAndClassifyNews } = require('./newsFetcher');
const { analyzeSentiment } = require('./newsSentimentAnalyzer');
const { routeNewsImpact } = require('./newsReactionRouter');

(async () => {
  try {
    const newsBatch = await fetchAndClassifyNews();
    if (!Array.isArray(newsBatch)) throw new Error('fetchAndClassifyNews array döndürmeli');
    if (newsBatch.length === 0) {
      console.warn('UYARI: Hiç haber bulunamadı veya API anahtarı eksik!');
      return;
    }
    for (const news of newsBatch) {
      const sentiment = analyzeSentiment(news.title, news.summary);
      const route = routeNewsImpact(news, sentiment);
      if (!news.title) throw new Error('Haber başlığı eksik!');
      if (typeof sentiment.sentimentScore !== 'number') throw new Error('Sentiment skoru yok!');
      if (!Array.isArray(route)) throw new Error('Route çıktısı array olmalı!');
      console.log('TEST BAŞARILI:', news.title);
    }
    console.log('Tüm pipeline zinciri testten geçti.');
  } catch (e) {
    console.error('TEST HATASI:', e.message);
    process.exit(1);
  }
})();
