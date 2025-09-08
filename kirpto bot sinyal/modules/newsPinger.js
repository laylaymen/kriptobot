// GELİŞMİŞ News Pinger - Ek modüller.txt prompt'una göre geliştirildi
// Hafif yük taraması, erken sinyal mekanizması
// 5 dakikada bir çalışır, sadece manşet tarar, kelime eşleşirse newsFetcher.fetchImmediate() çağırır

/**
 * Enhanced News Pinger Module
 * Hafif yük taraması ve erken sinyal sistemi
 * Ek modüller.txt prompt'una göre implementasyon
 */
class NewsPinger {
    constructor() {
        this.moduleName = 'newsPinger';
        
        // Ping configuration
        this.pingInterval = 5 * 60 * 1000; // 5 dakika
        this.isActive = false;
        this.pingTimer = null;
        
        // Critical keywords for early detection
        this.criticalKeywords = {
            // Emergency keywords - immediate trigger
            emergency: ['hack', 'hacked', 'exploit', 'stolen', 'down', 'collapse', 'crash', 'ban', 'banned'],
            
            // High priority keywords - quick trigger
            highPriority: ['ETF', 'approval', 'approved', 'regulation', 'SEC', 'Fed', 'inflation', 'emergency'],
            
            // Medium priority keywords - normal trigger
            mediumPriority: ['listing', 'partnership', 'adoption', 'announcement', 'launch', 'update'],
            
            // Low priority keywords - watch only
            lowPriority: ['price', 'market', 'analysis', 'prediction', 'forecast', 'trend']
        };
        
        // Ping history
        this.pingHistory = [];
        this.maxHistorySize = 200;
        
        // Trigger history
        this.triggerHistory = [];
        this.maxTriggerHistorySize = 50;
        
        // Performance metrics
        this.performanceMetrics = {
            totalPings: 0,
            successfulPings: 0,
            failedPings: 0,
            keywordMatches: 0,
            immediateTriggers: 0,
            avgPingTime: 0,
            lastError: null,
            uptime: Date.now()
        };
        
        // Rate limiting
        this.lastFullFetch = 0;
        this.minFetchInterval = 2 * 60 * 1000; // 2 dakika minimum aralık
        
        // Module dependencies
        this.newsFetcher = null;
        this.newsModeController = null;
        
        // API configurations
        this.apiConfig = {
            // Lightweight endpoint için daha az data
            pageSize: 5, // Sadece son 5 haber
            sortBy: 'publishedAt',
            language: 'en'
        };
        
        // Duplicate detection
        this.seenHeadlines = new Set();
        this.headlinesCacheSize = 100;
    }

    /**
     * News pinger'ı başlat
     */
    start() {
        try {
            if (this.isActive) {
                console.warn('News Pinger is already active');
                return;
            }
            
            this.isActive = true;
            
            // Module dependencies yükle
            this.loadModuleDependencies();
            
            // Ping timer'ını başlat
            this.startPingTimer();
            
            console.log('📡 News Pinger started - Light monitoring every 5 minutes');
            this.logEvent('pinger_started');
            
        } catch (error) {
            console.error('Failed to start news pinger:', error.message);
            this.performanceMetrics.lastError = error.message;
        }
    }

    /**
     * News pinger'ı durdur
     */
    stop() {
        try {
            this.isActive = false;
            
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
            
            console.log('📡 News Pinger stopped');
            this.logEvent('pinger_stopped');
            
        } catch (error) {
            console.error('Failed to stop news pinger:', error.message);
        }
    }

    /**
     * Module dependencies'i yükle
     */
    loadModuleDependencies() {
        try {
            // newsFetcher modülünü yükle
            try {
                const newsFetcher = require('./newsFetcher');
                this.newsFetcher = newsFetcher;
            } catch (error) {
                console.warn('Failed to load newsFetcher module:', error.message);
            }
            
            // newsModeController modülünü yükle
            try {
                const newsModeController = require('./newsModeController');
                this.newsModeController = newsModeController;
            } catch (error) {
                console.warn('Failed to load newsModeController module:', error.message);
            }
            
        } catch (error) {
            console.error('Failed to load module dependencies:', error.message);
        }
    }

    /**
     * Ping timer'ını başlat
     */
    startPingTimer() {
        this.pingTimer = setInterval(async () => {
            if (!this.isActive) return;
            
            try {
                await this.executePing();
            } catch (error) {
                console.error('Ping execution error:', error.message);
                this.performanceMetrics.lastError = error.message;
                this.performanceMetrics.failedPings++;
            }
        }, this.pingInterval);
        
        console.log('📡 Ping timer started (every 5 minutes)');
    }

    /**
     * Ana ping işlemini çalıştır
     */
    async executePing() {
        const pingId = `ping_${Date.now()}`;
        const startTime = Date.now();
        
        try {
            console.log('📡 Executing news ping...');
            
            // Lightweight news check
            const headlines = await this.fetchLightweightNews();
            
            if (!headlines || headlines.length === 0) {
                this.logPing(pingId, 'no_headlines', startTime);
                return;
            }
            
            // Keyword scanning
            const scanResults = this.scanHeadlinesForKeywords(headlines);
            
            // Trigger check
            const shouldTrigger = this.shouldTriggerImmediateFetch(scanResults);
            
            if (shouldTrigger) {
                await this.triggerImmediateFetch(scanResults);
            }
            
            // Log ping
            this.logPing(pingId, 'success', startTime, scanResults);
            
            console.log(`📡 Ping completed - ${headlines.length} headlines scanned, ${scanResults.totalMatches} keyword matches`);
            
        } catch (error) {
            console.error('Ping execution error:', error.message);
            this.logPing(pingId, 'error', startTime, null, error.message);
            this.performanceMetrics.failedPings++;
        }
    }

    /**
     * Lightweight news fetch (sadece başlıklar)
     */
    async fetchLightweightNews() {
        try {
            // Bu implementation basit bir headline fetch
            // Gerçek implementasyonda NewsAPI'den sadece başlıkları çeker
            
            // Mock headlines for demonstration
            const mockHeadlines = this.generateMockHeadlines();
            
            // Duplicate filtering
            const uniqueHeadlines = this.filterDuplicateHeadlines(mockHeadlines);
            
            return uniqueHeadlines;
            
        } catch (error) {
            console.error('Lightweight news fetch error:', error.message);
            return [];
        }
    }

    /**
     * Mock headlines oluştur (gerçek implementasyonda NewsAPI kullanılır)
     */
    generateMockHeadlines() {
        const sampleHeadlines = [
            'Bitcoin ETF approval expected this week',
            'Ethereum network upgrade completed successfully',
            'Major exchange reports unusual trading activity',
            'Crypto regulation discussions continue in Senate',
            'New partnership announced between major institutions'
        ];
        
        // Random headline seç
        const randomCount = Math.floor(Math.random() * 3) + 1;
        const selectedHeadlines = [];
        
        for (let i = 0; i < randomCount; i++) {
            const randomIndex = Math.floor(Math.random() * sampleHeadlines.length);
            selectedHeadlines.push({
                title: sampleHeadlines[randomIndex],
                publishedAt: new Date().toISOString(),
                source: 'Mock Source'
            });
        }
        
        return selectedHeadlines;
    }

    /**
     * Duplicate headline'ları filtrele
     */
    filterDuplicateHeadlines(headlines) {
        const uniqueHeadlines = [];
        
        for (const headline of headlines) {
            const headlineKey = this.generateHeadlineKey(headline.title);
            
            if (!this.seenHeadlines.has(headlineKey)) {
                this.seenHeadlines.add(headlineKey);
                uniqueHeadlines.push(headline);
            }
        }
        
        // Cache size kontrolü
        if (this.seenHeadlines.size > this.headlinesCacheSize) {
            // Cache'i temizle (LRU mantığı)
            const headlinesArray = Array.from(this.seenHeadlines);
            const keepCount = Math.floor(this.headlinesCacheSize * 0.8);
            this.seenHeadlines = new Set(headlinesArray.slice(-keepCount));
        }
        
        return uniqueHeadlines;
    }

    /**
     * Headline için unique key oluştur
     */
    generateHeadlineKey(title) {
        // Normalize headline for comparison
        return title.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 50); // İlk 50 karakter
    }

    /**
     * Headlines'ları keyword'ler için tara
     */
    scanHeadlinesForKeywords(headlines) {
        const scanResults = {
            totalMatches: 0,
            emergencyMatches: [],
            highPriorityMatches: [],
            mediumPriorityMatches: [],
            lowPriorityMatches: [],
            maxPriority: 'none'
        };
        
        for (const headline of headlines) {
            const titleLower = headline.title.toLowerCase();
            
            // Emergency keywords check
            for (const keyword of this.criticalKeywords.emergency) {
                if (titleLower.includes(keyword)) {
                    scanResults.emergencyMatches.push({
                        headline: headline,
                        keyword: keyword,
                        priority: 'emergency'
                    });
                    scanResults.totalMatches++;
                    scanResults.maxPriority = 'emergency';
                }
            }
            
            // High priority keywords check
            for (const keyword of this.criticalKeywords.highPriority) {
                if (titleLower.includes(keyword)) {
                    scanResults.highPriorityMatches.push({
                        headline: headline,
                        keyword: keyword,
                        priority: 'high'
                    });
                    scanResults.totalMatches++;
                    if (scanResults.maxPriority !== 'emergency') {
                        scanResults.maxPriority = 'high';
                    }
                }
            }
            
            // Medium priority keywords check
            for (const keyword of this.criticalKeywords.mediumPriority) {
                if (titleLower.includes(keyword)) {
                    scanResults.mediumPriorityMatches.push({
                        headline: headline,
                        keyword: keyword,
                        priority: 'medium'
                    });
                    scanResults.totalMatches++;
                    if (!['emergency', 'high'].includes(scanResults.maxPriority)) {
                        scanResults.maxPriority = 'medium';
                    }
                }
            }
            
            // Low priority keywords check
            for (const keyword of this.criticalKeywords.lowPriority) {
                if (titleLower.includes(keyword)) {
                    scanResults.lowPriorityMatches.push({
                        headline: headline,
                        keyword: keyword,
                        priority: 'low'
                    });
                    scanResults.totalMatches++;
                    if (scanResults.maxPriority === 'none') {
                        scanResults.maxPriority = 'low';
                    }
                }
            }
        }
        
        return scanResults;
    }

    /**
     * Immediate fetch tetiklensin mi kontrol et
     */
    shouldTriggerImmediateFetch(scanResults) {
        // Emergency kelimeler varsa hemen tetikle
        if (scanResults.emergencyMatches.length > 0) {
            return true;
        }
        
        // High priority kelimeler varsa tetikle
        if (scanResults.highPriorityMatches.length > 0) {
            return true;
        }
        
        // Medium priority kelimeler 2 veya daha fazlaysa tetikle
        if (scanResults.mediumPriorityMatches.length >= 2) {
            return true;
        }
        
        // Mode controller'dan current mode'a göre karar ver
        if (this.newsModeController) {
            const currentMode = this.newsModeController.getCurrentMode();
            
            // Aggressive mode'da medium priority bile tetikler
            if (currentMode === 'aggressive' && scanResults.mediumPriorityMatches.length > 0) {
                return true;
            }
            
            // Active mode'da yüksek keyword density tetikler
            if (currentMode === 'active' && scanResults.totalMatches >= 3) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Immediate fetch tetikle
     */
    async triggerImmediateFetch(scanResults) {
        try {
            // Rate limiting check
            const now = Date.now();
            if (now - this.lastFullFetch < this.minFetchInterval) {
                console.log('📡 Rate limiting: Skipping immediate fetch (too soon)');
                return;
            }
            
            this.lastFullFetch = now;
            this.performanceMetrics.immediateTriggers++;
            
            console.log(`🚨 Triggering immediate news fetch - Priority: ${scanResults.maxPriority}, Matches: ${scanResults.totalMatches}`);
            
            // newsFetcher.fetchImmediate() çağır
            if (this.newsFetcher && this.newsFetcher.fetchImmediate) {
                await this.newsFetcher.fetchImmediate();
            } else if (this.newsFetcher && this.newsFetcher.fetchNews) {
                await this.newsFetcher.fetchNews();
            } else {
                console.warn('No immediate fetch function available in newsFetcher');
            }
            
            // Trigger history'e ekle
            this.logTrigger(scanResults);
            
        } catch (error) {
            console.error('Immediate fetch trigger error:', error.message);
        }
    }

    /**
     * Ping'i logla
     */
    logPing(pingId, status, startTime, scanResults = null, error = null) {
        const pingTime = Date.now() - startTime;
        
        const pingRecord = {
            id: pingId,
            timestamp: startTime,
            status: status,
            pingTime: pingTime,
            scanResults: scanResults,
            error: error
        };
        
        this.pingHistory.push(pingRecord);
        
        if (this.pingHistory.length > this.maxHistorySize) {
            this.pingHistory = this.pingHistory.slice(-this.maxHistorySize);
        }
        
        // Performance metrics güncelle
        this.performanceMetrics.totalPings++;
        
        if (status === 'success') {
            this.performanceMetrics.successfulPings++;
            if (scanResults) {
                this.performanceMetrics.keywordMatches += scanResults.totalMatches;
            }
        }
        
        // Average ping time güncelle
        if (this.performanceMetrics.avgPingTime === 0) {
            this.performanceMetrics.avgPingTime = pingTime;
        } else {
            this.performanceMetrics.avgPingTime = 
                (this.performanceMetrics.avgPingTime + pingTime) / 2;
        }
    }

    /**
     * Trigger'ı logla
     */
    logTrigger(scanResults) {
        const triggerRecord = {
            timestamp: Date.now(),
            priority: scanResults.maxPriority,
            totalMatches: scanResults.totalMatches,
            emergencyCount: scanResults.emergencyMatches.length,
            highPriorityCount: scanResults.highPriorityMatches.length,
            mediumPriorityCount: scanResults.mediumPriorityMatches.length,
            lowPriorityCount: scanResults.lowPriorityMatches.length,
            topKeywords: this.extractTopKeywords(scanResults)
        };
        
        this.triggerHistory.push(triggerRecord);
        
        if (this.triggerHistory.length > this.maxTriggerHistorySize) {
            this.triggerHistory = this.triggerHistory.slice(-this.maxTriggerHistorySize);
        }
    }

    /**
     * Top keyword'leri çıkar
     */
    extractTopKeywords(scanResults) {
        const allMatches = [
            ...scanResults.emergencyMatches,
            ...scanResults.highPriorityMatches,
            ...scanResults.mediumPriorityMatches,
            ...scanResults.lowPriorityMatches
        ];
        
        const keywordCounts = {};
        allMatches.forEach(match => {
            keywordCounts[match.keyword] = (keywordCounts[match.keyword] || 0) + 1;
        });
        
        return Object.entries(keywordCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([keyword, count]) => ({ keyword, count }));
    }

    /**
     * Event logla
     */
    logEvent(eventType, data = {}) {
        console.log(`📡 News Pinger Event: ${eventType}`, data);
    }

    /**
     * Manual ping tetikle
     */
    async triggerManualPing() {
        if (!this.isActive) {
            console.log('News Pinger is not active');
            return;
        }
        
        console.log('🔧 Manual ping triggered');
        await this.executePing();
    }

    /**
     * Keyword ekle/kaldır
     */
    addKeyword(category, keyword) {
        if (this.criticalKeywords[category]) {
            if (!this.criticalKeywords[category].includes(keyword)) {
                this.criticalKeywords[category].push(keyword);
                console.log(`✅ Added keyword '${keyword}' to ${category} category`);
            }
        }
    }

    removeKeyword(category, keyword) {
        if (this.criticalKeywords[category]) {
            const index = this.criticalKeywords[category].indexOf(keyword);
            if (index > -1) {
                this.criticalKeywords[category].splice(index, 1);
                console.log(`❌ Removed keyword '${keyword}' from ${category} category`);
            }
        }
    }

    // Getter methods
    getStatus() {
        return {
            isActive: this.isActive,
            pingInterval: this.pingInterval,
            lastFullFetch: this.lastFullFetch,
            seenHeadlinesCount: this.seenHeadlines.size,
            performanceMetrics: this.performanceMetrics
        };
    }

    getPingHistory(limit = 20) {
        return this.pingHistory.slice(-limit);
    }

    getTriggerHistory(limit = 10) {
        return this.triggerHistory.slice(-limit);
    }

    getKeywordStats() {
        const stats = {};
        
        Object.entries(this.criticalKeywords).forEach(([category, keywords]) => {
            stats[category] = {
                count: keywords.length,
                keywords: keywords
            };
        });
        
        return stats;
    }

    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            uptime: Date.now() - this.performanceMetrics.uptime,
            successRate: this.performanceMetrics.totalPings > 0 ? 
                (this.performanceMetrics.successfulPings / this.performanceMetrics.totalPings) * 100 : 0,
            avgKeywordsPerPing: this.performanceMetrics.totalPings > 0 ?
                this.performanceMetrics.keywordMatches / this.performanceMetrics.totalPings : 0
        };
    }

    getModuleInfo() {
        return {
            name: 'NewsPinger',
            version: '2.0.0',
            description: 'GELİŞMİŞ hafif haber tarama - Ek modüller.txt prompt\'una göre geliştirildi',
            isActive: this.isActive,
            pingInterval: this.pingInterval,
            keywordCategories: Object.keys(this.criticalKeywords),
            performanceMetrics: this.getPerformanceMetrics()
        };
    }
}

// Singleton instance oluşturma
const newsPinger = new NewsPinger();

module.exports = {
    NewsPinger,
    newsPinger
};
