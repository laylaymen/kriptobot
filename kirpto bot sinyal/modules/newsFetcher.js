
// NewsData.io tabanlı haber çekici ve sınıflandırıcı modül
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');

const NEWS_API_URL = 'https://newsdata.io/api/1/crypto';
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const DEFAULT_KEYWORDS = [
  'bitcoin', 'crypto', 'SEC', 'ETF', 'hack', 'ban', 'regulation', 'approval'
];
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 dakika
const CACHE_FILE = __dirname + '/fetchedNewsIDs.json';

let newsCache = {
  lastFetch: 0,
  articles: [],
  fetchedIds: new Set()
};

// Load cache from file
try {
  if (fs.existsSync(CACHE_FILE)) {
    const ids = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    newsCache.fetchedIds = new Set(ids);
  }
} catch (e) {
  console.warn('[newsFetcher] Cache file error:', e.message);
}

function getArticleId(article) {
  // Benzersiz ID: pubDate + title hash
  return crypto.createHash('md5').update((article.pubDate || '') + (article.title || '')).digest('hex');
}

const IMPACT_KEYWORDS = [
  { category: 'regulation', keywords: ['SEC', 'ban', 'regulation', 'illegal'], impact: 'risk_high', systems: ['LIVIA', 'Denetim Asistanı'] },
  { category: 'approval', keywords: ['ETF', 'approval', 'listing'], impact: 'price_jump', systems: ['Grafik Beyni', 'VIVO'] },
  { category: 'hack', keywords: ['exploit', 'hacked', 'down', 'rug', 'collapse'], impact: 'panic', systems: ['LIVIA', 'Denetim Asistanı'] },
  { category: 'macro', keywords: ['inflation', 'debt', 'credit', 'Fed'], impact: 'macro_shift', systems: ['Denetim Asistanı'] }
];

function classifyImpact(article) {
  const title = (article.title || '').toLowerCase();
  const description = (article.description || '').toLowerCase();
  let impactCategory = 'other';
  let impactTag = 'neutral';
  let matchedKeywords = [];
  let affectedSystems = [];
  let suggestedAction = '';
  let triggeredModules = [];

  for (const group of IMPACT_KEYWORDS) {
    for (const kw of group.keywords) {
      if (title.includes(kw.toLowerCase()) || description.includes(kw.toLowerCase())) {
        impactCategory = group.category;
        impactTag = group.impact;
        matchedKeywords.push(kw);
        affectedSystems = group.systems;
        // Modül haritalama örnekleri
        if (group.impact === 'price_jump') {
          suggestedAction = 'Prepare for volatility spike';
          triggeredModules = ['reflexivePatternTracker.js', 'adaptiveScenarioBuilder.js', 'emotionalDefenseLauncher.js'];
        }
        if (group.impact === 'panic') {
          suggestedAction = 'Activate defense mechanisms';
          triggeredModules = ['emergencyHoldActivator.js', 'macroDisruptionLog.js', 'adaptiveScenarioBuilder.js'];
        }
        if (group.impact === 'risk_high') {
          suggestedAction = 'Suppress aggressive strategies';
          triggeredModules = ['contextSuppressionTrigger.js', 'strategyIntegrityEvaluator.js'];
        }
        if (group.impact === 'macro_shift') {
          suggestedAction = 'Log macro event';
          triggeredModules = ['macroDisruptionLog.js'];
        }
      }
    }
  }

  return {
    impactCategory,
    impactTag,
    matchedKeywords,
    affectedSystems,
    suggestedAction,
    triggeredModules
  };
}

async function fetchNews(keywords = DEFAULT_KEYWORDS) {
  const now = Date.now();
  if (now - newsCache.lastFetch < CACHE_DURATION_MS) {
    return newsCache.articles;
  }

  try {
    const q = keywords.join('+');
    const url = `${NEWS_API_URL}?apikey=${NEWS_API_KEY}&q=${encodeURIComponent(q)}&language=en`;
    const response = await axios.get(url);
    const articles = response.data.results || [];

    // Benzersiz ve yeni haberleri seç
    const newArticles = articles.filter(article => {
      const id = getArticleId(article);
      if (newsCache.fetchedIds.has(id)) return false;
      newsCache.fetchedIds.add(id);
      return true;
    });

    // Save cache to file
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(Array.from(newsCache.fetchedIds)), 'utf8');
    } catch (e) {
      console.warn('[newsFetcher] Cache write error:', e.message);
    }

    newsCache.lastFetch = now;
    newsCache.articles = newArticles;
    return newArticles;
  } catch (err) {
    console.warn('[newsFetcher] Hata:', err.message);
    return [];
  }
}

let latestNewsImpact = [];

async function fetchAndClassifyNews(keywords = DEFAULT_KEYWORDS) {
  const articles = await fetchNews(keywords);
  latestNewsImpact = articles.map(article => {
    const impact = classifyImpact(article);
    return {
      timestamp: article.pubDate,
      title: article.title,
      source: article.source_name || article.source_id || '',
      impactCategory: impact.impactCategory,
      impactTag: impact.impactTag,
      matchedKeywords: impact.matchedKeywords,
      affectedSystems: impact.affectedSystems,
      triggeredModules: impact.triggeredModules,
      suggestedAction: impact.suggestedAction,
      url: article.link,
      summary: article.description || '',
      isValid: !!impact.impactCategory && impact.impactCategory !== 'other'
    };
  });
  return latestNewsImpact;
}

function getLatestNewsImpact() {
  return latestNewsImpact;
}

module.exports = { fetchNews, fetchAndClassifyNews, getLatestNewsImpact };