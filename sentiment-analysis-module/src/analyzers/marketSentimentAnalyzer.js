class MarketSentimentAnalyzer {
    constructor() {
        this.moduleName = 'marketSentimentAnalyzer';
        
        // Sentiment word mapping for market analysis
        this.sentimentWords = {
            positive: ['bullish', 'rally', 'surge', 'growth', 'profit', 'gain'],
            negative: ['bearish', 'decline', 'loss', 'crash', 'drop', 'collapse'],
            neutral: ['stable', 'unchanged', 'flat']
        };
        
        // Action suggestions based on market sentiment
        this.actionMappings = {
            positive: {
                action: 'Consider increasing investment or trading volume'
            },
            negative: {
                action: 'Review positions and consider risk management strategies'
            },
            neutral: {
                action: 'Maintain current positions and monitor market closely'
            }
        };
    }

    analyzeMarketSentiment(financialIndicators) {
        let sentimentScore = 0;
        let matchedWords = [];

        financialIndicators.forEach(indicator => {
            const words = this.extractWords(indicator);
            words.forEach(word => {
                const score = this.getWordScore(word);
                if (score !== 0) {
                    sentimentScore += score;
                    matchedWords.push(word);
                }
            });
        });

        const sentimentTag = this.classifySentiment(sentimentScore);
        const actionSuggested = this.actionMappings[sentimentTag].action;

        return {
            sentimentScore: this.normalizeScore(sentimentScore),
            sentimentTag: sentimentTag,
            matchedWords: matchedWords,
            actionSuggested: actionSuggested
        };
    }

    extractWords(text) {
        return text.toLowerCase().match(/\w+/g) || [];
    }

    getWordScore(word) {
        if (this.sentimentWords.positive.includes(word)) return 1;
        if (this.sentimentWords.negative.includes(word)) return -1;
        return 0;
    }

    classifySentiment(score) {
        if (score > 0) return 'positive';
        if (score < 0) return 'negative';
        return 'neutral';
    }

    normalizeScore(score) {
        return Math.max(-1, Math.min(1, score)); // Normalize to -1..1
    }

    getModuleInfo() {
        return {
            name: this.moduleName,
            description: 'Analyzes market sentiment based on financial indicators and news.',
            supportedSentiments: Object.keys(this.sentimentWords),
            actionMappings: this.actionMappings
        };
    }
}

// Singleton instance creation
const marketSentimentAnalyzer = new MarketSentimentAnalyzer();

// Exporting the module
module.exports = {
    MarketSentimentAnalyzer,
    marketSentimentAnalyzer
};