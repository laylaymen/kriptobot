class SentimentAnalysisModule {
    constructor() {
        this.newsSentimentAnalyzer = require('./analyzers/newsSentimentAnalyzer').NewsSentimentAnalyzer;
        this.socialSentimentAnalyzer = require('./analyzers/socialSentimentAnalyzer').SocialSentimentAnalyzer;
        this.marketSentimentAnalyzer = require('./analyzers/marketSentimentAnalyzer').MarketSentimentAnalyzer;

        this.sentimentWords = require('./data/sentimentWords');
        this.cryptoKeywords = require('./data/cryptoKeywords');
        this.actionMappings = require('./data/actionMappings');

        this.textProcessor = require('./utils/textProcessor');
        this.scoreCalculator = require('./utils/scoreCalculator');
        this.confidenceCalculator = require('./utils/confidenceCalculator');

        this.batchAnalyzer = require('./services/batchAnalyzer');
        this.historyManager = require('./services/historyManager');
        this.performanceTracker = require('./services/performanceTracker');
    }

    analyzeNews(title, description) {
        const analyzer = new this.newsSentimentAnalyzer();
        return analyzer.analyzeSentiment(title, description);
    }

    analyzeSocialMedia(post) {
        const analyzer = new this.socialSentimentAnalyzer();
        return analyzer.analyzeSentiment(post);
    }

    analyzeMarketIndicators(indicator) {
        const analyzer = new this.marketSentimentAnalyzer();
        return analyzer.analyzeSentiment(indicator);
    }

    analyzeBatchNews(newsItems) {
        return this.batchAnalyzer.analyzeBatchSentiment(newsItems);
    }

    getHistory() {
        return this.historyManager.getHistory();
    }

    trackPerformance() {
        return this.performanceTracker.getPerformanceMetrics();
    }
}

module.exports = new SentimentAnalysisModule();