
// GELİŞMİŞ News Fetcher Module - Ek modüller.txt prompt'una göre geliştirildi
// NewsAPI entegrasyonu, sistem bazlı haber filtreleme, etki analizi
// Her 30 dakikada çalışır, sistemlere akıllı sinyal gönderir

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * Enhanced News Fetcher Module  
 * Gelişmiş haber çekme sistemi - Ek modüller.txt prompt'una göre implementasyon
 * NewsAPI entegrasyonu, sistem bazlı haber filtreleme, etki analizi
 */
class NewsFetcher {
    constructor() {
        this.moduleName = 'newsFetcher';
        this.newsApiKey = process.env.NEWS_API_KEY;
        this.baseUrl = 'https://newsapi.org/v2';
        this.requestLimit = 1000; // Saatte 1000 istek limiti
        this.requestsThisHour = 0;
        this.hourlyResetTime = Date.now() + (60 * 60 * 1000);
        
        // Anahtar kelime kategorileri (ek modüller.txt'den)
        this.keywordCategories = {
            regulation: {
                keywords: ['SEC', 'ban', 'regulation', 'illegal', 'compliance', 'CFTC', 'regulatory'],
                impact: 'regulatory',
                systems: ['LIVIA', 'denetimAsistani'],
                severity: 'high'
            },
            approval: {
                keywords: ['ETF', 'approval', 'listing', 'accepted', 'approved', 'spot ETF'],
                impact: 'positive',
                systems: ['grafikBeyni', 'VIVO'],
                severity: 'high'
            },
            hack: {
                keywords: ['exploit', 'hacked', 'hack', 'down', 'rug', 'scam', 'stolen'],
                impact: 'security',
                systems: ['LIVIA', 'emergencySystem'],
                severity: 'critical'
            },
            macro: {
                keywords: ['inflation', 'debt', 'credit', 'Fed', 'Federal Reserve', 'interest rate'],
                impact: 'macroeconomic',
                systems: ['denetimAsistani', 'grafikBeyni'],
                severity: 'medium'
            }
        };
        
        // Sistem entegrasyon haritası (ek modüller.txt'den)
        this.systemActionMap = {
            grafikBeyni: {
                modules: ['reflexivePatternTracker', 'adaptiveScenarioBuilder', 'falseBreakFilter', 'volumeConfirmBreakout'],
                actions: ['volatility_spike_guard', 'pattern_analysis', 'breakout_validation']
            },
            LIVIA: {
                modules: ['emotionalDefenseLauncher', 'contextSuppressionTrigger', 'emergencyHoldActivator'],
                actions: ['emotional_pressure', 'signal_suppression', 'emergency_hold']
            },
            denetimAsistani: {
                modules: ['macroDisruptionLog', 'strategyIntegrityEvaluator', 'formationPerformanceTracker'],
                actions: ['macro_logging', 'strategy_evaluation', 'performance_tracking']
            }
        };
        
        this.fetchedNewsFile = path.join(__dirname, '..', '..', 'data', 'fetchedNewsIDs.json');
        this.newsHistory = [];
        this.maxHistorySize = 200;
        this.updateInterval = 30 * 60 * 1000; // 30 dakika (ek modüller.txt'den)
        this.lastFetchTime = 0;
        
        // Performance metrics
        this.performanceMetrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            newsProcessed: 0,
            avgResponseTime: 0,
            cacheHits: 0
        };
    }

    /**
     * Ana haber çekme fonksiyonu - ek modüller.txt format'ında
     */
    async fetchNews(keywords = null, forceUpdate = false) {
        const startTime = Date.now();
        
        try {
            // Rate limit kontrolü (1.000 istek/saat)
            if (!this.checkRateLimit()) {
                console.warn('News API rate limit reached');
                return this.getCachedNews();
            }
            
            // 30 dakika interval kontrolü
            if (!forceUpdate && (Date.now() - this.lastFetchTime) < this.updateInterval) {
                return this.getCachedNews();
            }
            
            // Default keyword query oluşturma
            const queryString = keywords || this.buildDefaultQuery();
            
            // NewsAPI'den haber çekme
            const newsData = await this.fetchFromNewsAPI(queryString);
            
            if (!newsData || !newsData.articles) {
                throw new Error('Invalid news data received');
            }
            
            // Haberleri işleme ve sınıflandırma
            const processedNews = await this.processNewsData(newsData.articles);
            
            // Sistem etkilerini belirleme
            const systemImpacts = this.analyzeSystemImpacts(processedNews);
            
            // Cache güncelleme
            this.updateNewsCache(processedNews);
            
            // Son fetch zamanını güncelleme
            this.lastFetchTime = Date.now();
            
            // Ek modüller.txt format'ında result
            const result = {
                timestamp: new Date().toISOString(),
                impactLevel: this.calculateOverallImpactLevel(processedNews),
                affectedSystems: this.getAffectedSystems(processedNews),
                categories: this.getNewsCategories(processedNews),
                matchedKeywords: this.getAllMatchedKeywords(processedNews),
                totalArticles: newsData.totalResults || 0,
                processedArticles: processedNews.length,
                systemImpacts: systemImpacts,
                newsList: processedNews,
                export: this.generateSystemExports(processedNews),
                performanceMetrics: this.performanceMetrics,
                isValid: true,
                cacheStatus: 'fresh'
            };
            
            // Performance tracking
            this.updatePerformanceMetrics(startTime, true);
            
            return result;
            
        } catch (error) {
            console.error('NewsFetcher error:', error.message);
            this.updatePerformanceMetrics(startTime, false);
            return this.getDefaultResult(error.message);
        }
    }

    /**
     * Default keyword query oluşturma (ek modüller.txt'den)
     */
    buildDefaultQuery() {
        // "bitcoin+SEC+ETF+hack+ban+regulation+approval" formatında
        const baseKeywords = ['bitcoin', 'crypto'];
        const allKeywords = [];
        
        Object.values(this.keywordCategories).forEach(category => {
            allKeywords.push(...category.keywords.slice(0, 2)); // Her kategoriden 2 keyword
        });
        
        const combinedKeywords = [...baseKeywords, ...allKeywords.slice(0, 5)];
        return combinedKeywords.join('+');
    }

    /**
     * NewsAPI'den veri çekme (retry ile)
     */
    async fetchFromNewsAPI(query) {
        if (!this.newsApiKey) {
            throw new Error('NEWS_API_KEY not configured');
        }
        
        const url = `${this.baseUrl}/everything`;
        const params = {
            q: query,
            language: 'en',
            sortBy: 'publishedAt',
            pageSize: 50,
            apiKey: this.newsApiKey
        };
        
        this.performanceMetrics.totalRequests++;
        this.requestsThisHour++;
        
        const response = await axios.get(url, {
            params: params,
            timeout: 15000
        });
        
        if (response.data.status !== 'ok') {
            throw new Error(`NewsAPI error: ${response.data.message || 'Unknown error'}`);
        }
        
        this.performanceMetrics.successfulRequests++;
        return response.data;
    }

    /**
     * Haber verilerini işleme ve sınıflandırma
     */
    async processNewsData(articles) {
        const processedNews = [];
        const existingNewsIds = await this.loadExistingNewsIds();
        
        for (const article of articles) {
            try {
                // News ID oluşturma (hash)
                const newsId = this.generateNewsId(article.title, article.publishedAt);
                
                // Daha önce işlenmiş mi kontrolü (cache)
                if (existingNewsIds.has(newsId)) {
                    continue;
                }
                
                // Haber analizi ve sınıflandırma
                const analysis = this.analyzeNewsItem(article);
                
                if (analysis.isRelevant) {
                    const processedItem = {
                        id: newsId,
                        title: article.title,
                        summary: article.description || '',
                        url: article.url,
                        source: article.source?.name || 'Unknown',
                        publishedAt: article.publishedAt,
                        timestamp: new Date(article.publishedAt).getTime(),
                        impactCategory: analysis.impactCategory,
                        impactLevel: analysis.impactLevel,
                        matchedKeywords: analysis.matchedKeywords,
                        systemTargets: analysis.systemTargets,
                        actionSuggestions: analysis.actionSuggestions,
                        priority: analysis.priority
                    };
                    
                    processedNews.push(processedItem);
                    existingNewsIds.add(newsId);
                    this.performanceMetrics.newsProcessed++;
                }
                
            } catch (error) {
                console.warn('News processing error:', error.message);
            }
        }
        
        // Yeni news ID'leri kaydetme
        await this.saveExistingNewsIds(existingNewsIds);
        
        return processedNews.sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Tek haber analizi (ek modüller.txt anahtar kelime sistemi)
     */
    analyzeNewsItem(article) {
        const title = (article.title || '').toLowerCase();
        const description = (article.description || '').toLowerCase();
        const fullText = `${title} ${description}`;
        
        let matchedKeywords = [];
        let impactCategory = 'neutral';
        let impactLevel = 'low';
        let systemTargets = [];
        let priority = 1;
        
        // Keyword kategorileri ile eşleştirme
        for (const [categoryName, categoryData] of Object.entries(this.keywordCategories)) {
            const foundKeywords = categoryData.keywords.filter(keyword => 
                fullText.includes(keyword.toLowerCase())
            );
            
            if (foundKeywords.length > 0) {
                matchedKeywords.push(...foundKeywords);
                impactCategory = categoryData.impact;
                impactLevel = categoryData.severity;
                systemTargets.push(...categoryData.systems);
                
                // Priority hesaplama
                priority = Math.max(priority, foundKeywords.length * 2);
                if (categoryData.severity === 'critical') priority += 5;
                if (categoryData.severity === 'high') priority += 3;
            }
        }
        
        // Action suggestions oluşturma
        const actionSuggestions = this.generateActionSuggestions(impactCategory, impactLevel, systemTargets);
        
        return {
            isRelevant: matchedKeywords.length > 0,
            impactCategory: impactCategory,
            impactLevel: impactLevel,
            matchedKeywords: [...new Set(matchedKeywords)],
            systemTargets: [...new Set(systemTargets)],
            actionSuggestions: actionSuggestions,
            priority: priority
        };
    }

    /**
     * Sistem export'ları oluşturma (ek modüller.txt format'ında)
     */
    generateSystemExports(processedNews) {
        const exports = {};
        
        // Her sistem için export oluştur
        Object.keys(this.systemActionMap).forEach(system => {
            const relevantNews = processedNews.filter(news => 
                news.systemTargets.includes(system)
            );
            
            if (relevantNews.length > 0) {
                const highestPriorityNews = relevantNews.reduce((max, news) => 
                    news.priority > max.priority ? news : max
                );
                
                exports[system] = {
                    trigger: this.systemActionMap[system].modules[0], // İlk modül
                    suggestedAction: this.getSuggestedActionForSystem(system, highestPriorityNews),
                    newsCount: relevantNews.length,
                    highestImpact: highestPriorityNews.impactLevel,
                    latestNews: highestPriorityNews.title
                };
            }
        });
        
        return exports;
    }

    /**
     * Sistem için önerilen aksiyon
     */
    getSuggestedActionForSystem(system, news) {
        if (system === 'grafikBeyni') {
            if (news.impactCategory === 'positive') return 'volatility spike guard';
            if (news.impactCategory === 'security') return 'falseBreakFilter aktif et';
        }
        
        if (system === 'LIVIA') {
            if (news.impactCategory === 'security') return 'emergency hold';
            if (news.impactCategory === 'regulatory') return 'sinyal baskı';
        }
        
        if (system === 'denetimAsistani') {
            return 'macro event logging';
        }
        
        return 'monitor situation';
    }

    /**
     * Son haber etkisi alma - diğer modüller için
     */
    getLatestNewsImpact() {
        const recentNews = this.newsHistory
            .filter(news => (Date.now() - news.timestamp) < (2 * 60 * 60 * 1000)) // Son 2 saat
            .sort((a, b) => b.timestamp - a.timestamp);
        
        if (recentNews.length === 0) {
            return {
                hasRecentImpact: false,
                impactLevel: 'none',
                systemAlerts: {},
                lastUpdate: this.lastFetchTime
            };
        }
        
        const highestPriorityNews = recentNews.reduce((max, news) => 
            news.priority > max.priority ? news : max
        );
        
        return {
            hasRecentImpact: true,
            impactLevel: highestPriorityNews.impactLevel,
            impactCategory: highestPriorityNews.impactCategory,
            latestNews: highestPriorityNews,
            systemAlerts: highestPriorityNews.actionSuggestions,
            affectedSystems: highestPriorityNews.systemTargets,
            totalRecentNews: recentNews.length,
            lastUpdate: this.lastFetchTime
        };
    }

    // Rate limit ve cache helper methods
    checkRateLimit() {
        if (Date.now() > this.hourlyResetTime) {
            this.requestsThisHour = 0;
            this.hourlyResetTime = Date.now() + (60 * 60 * 1000);
        }
        return this.requestsThisHour < this.requestLimit;
    }

    generateNewsId(title, publishedAt) {
        const combinedString = `${title}${publishedAt}`;
        return crypto.createHash('md5').update(combinedString).digest('hex');
    }

    async loadExistingNewsIds() {
        try {
            const data = await fs.readFile(this.fetchedNewsFile, 'utf8');
            const newsIds = JSON.parse(data);
            return new Set(newsIds);
        } catch (error) {
            return new Set();
        }
    }

    async saveExistingNewsIds(newsIdsSet) {
        try {
            const dir = path.dirname(this.fetchedNewsFile);
            await fs.mkdir(dir, { recursive: true });
            
            const newsIdsArray = Array.from(newsIdsSet);
            const idsToSave = newsIdsArray.slice(-1000); // Son 1000 ID
            
            await fs.writeFile(this.fetchedNewsFile, JSON.stringify(idsToSave, null, 2));
        } catch (error) {
            console.warn('Failed to save news IDs:', error.message);
        }
    }

    getCachedNews() {
        return {
            timestamp: new Date().toISOString(),
            impactLevel: 'low',
            affectedSystems: [],
            categories: [],
            matchedKeywords: [],
            totalArticles: 0,
            processedArticles: this.newsHistory.length,
            systemImpacts: {},
            newsList: this.newsHistory.slice(-20),
            export: {},
            performanceMetrics: this.performanceMetrics,
            isValid: true,
            cacheStatus: 'cached'
        };
    }

    updateNewsCache(processedNews) {
        this.newsHistory.push(...processedNews);
        if (this.newsHistory.length > this.maxHistorySize) {
            this.newsHistory = this.newsHistory.slice(-this.maxHistorySize);
        }
    }

    updatePerformanceMetrics(startTime, success) {
        const responseTime = Date.now() - startTime;
        this.performanceMetrics.avgResponseTime = 
            (this.performanceMetrics.avgResponseTime + responseTime) / 2;
        
        if (!success) {
            this.performanceMetrics.failedRequests++;
        }
    }

    getDefaultResult(errorMessage) {
        return {
            timestamp: new Date().toISOString(),
            impactLevel: 'none',
            affectedSystems: [],
            categories: [],
            matchedKeywords: [],
            totalArticles: 0,
            processedArticles: 0,
            systemImpacts: {},
            newsList: [],
            export: {},
            performanceMetrics: this.performanceMetrics,
            isValid: false,
            error: errorMessage,
            cacheStatus: 'error'
        };
    }

    getModuleInfo() {
        return {
            name: 'NewsFetcher',
            version: '2.0.0',
            description: 'GELİŞMİŞ haber çekme sistemi - Ek modüller.txt prompt\'una göre geliştirildi',
            supportedSystems: Object.keys(this.systemActionMap),
            keywordCategories: Object.keys(this.keywordCategories),
            requestLimit: this.requestLimit,
            updateInterval: this.updateInterval / 60000 + ' minutes',
            performanceMetrics: this.performanceMetrics
        };
    }
}

// Singleton instance oluşturma
const newsFetcher = new NewsFetcher();

// Legacy function compatibility
async function fetchNews(keywords) {
    return await newsFetcher.fetchNews(keywords);
}

// Ana haber impact fonksiyonu
function getLatestNewsImpact() {
    return newsFetcher.getLatestNewsImpact();
}

module.exports = { 
    NewsFetcher,
    newsFetcher,
    fetchNews,
    getLatestNewsImpact
};

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