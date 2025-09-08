class SocialSentimentAnalyzer {
    constructor() {
        this.moduleName = 'socialSentimentAnalyzer';
        
        // Sentiment word mapping (similar to news sentiment analyzer)
        this.sentimentWords = {
            positive: {
                strong: ['love', 'great', 'amazing', 'fantastic', 'awesome', 'happy', 'success', 'win'],
                moderate: ['good', 'nice', 'positive', 'like', 'enjoy', 'happy']
            },
            negative: {
                strong: ['hate', 'terrible', 'awful', 'bad', 'worst', 'disaster', 'fail'],
                moderate: ['sad', 'down', 'negative', 'dislike', 'worry']
            },
            neutral: ['okay', 'fine', 'average', 'normal', 'meh']
        };

        // Action suggestions mapping
        this.actionMappings = {
            positive: {
                high: 'engage with positive content',
                moderate: 'share positive feedback'
            },
            negative: {
                high: 'address negative feedback immediately',
                moderate: 'monitor for further issues'
            },
            neutral: {
                any: 'continue monitoring social sentiment'
            }
        };

        this.analysisHistory = [];
        this.maxHistorySize = 100;
    }

    analyzeSentiment(post) {
        const fullText = post.toLowerCase();
        const words = this.preprocessText(fullText);
        const sentimentScore = this.calculateSentimentScore(words);
        const sentimentTag = this.classifySentiment(sentimentScore);
        const actionSuggestions = this.generateActionSuggestions(sentimentTag);

        const result = {
            post: post,
            sentimentScore: this.roundScore(sentimentScore),
            sentimentTag: sentimentTag,
            actionSuggested: actionSuggestions,
            metadata: {
                analysisTimestamp: Date.now(),
                wordCount: words.length
            }
        };

        this.updateHistory(result);
        return result;
    }

    preprocessText(text) {
        return text
            .replace(/[^\w\s]/g, '')
            .split(' ')
            .filter(word => word.length > 2);
    }

    calculateSentimentScore(words) {
        let totalScore = 0;
        let matchedWords = 0;

        words.forEach(word => {
            const score = this.getWordScore(word);
            if (score !== 0) {
                totalScore += score;
                matchedWords++;
            }
        });

        return matchedWords === 0 ? 0 : totalScore / matchedWords;
    }

    getWordScore(word) {
        if (this.sentimentWords.positive.strong.includes(word)) return 2;
        if (this.sentimentWords.positive.moderate.includes(word)) return 1;
        if (this.sentimentWords.negative.strong.includes(word)) return -2;
        if (this.sentimentWords.negative.moderate.includes(word)) return -1;
        return 0;
    }

    classifySentiment(score) {
        if (score > 0.2) return 'positive';
        if (score < -0.2) return 'negative';
        return 'neutral';
    }

    generateActionSuggestions(sentimentTag) {
        return this.actionMappings[sentimentTag] || {};
    }

    roundScore(score) {
        return Math.round(score * 100) / 100;
    }

    updateHistory(result) {
        this.analysisHistory.push(result);
        if (this.analysisHistory.length > this.maxHistorySize) {
            this.analysisHistory = this.analysisHistory.slice(-this.maxHistorySize);
        }
    }

    getModuleInfo() {
        return {
            name: 'SocialSentimentAnalyzer',
            version: '1.0.0',
            description: 'Analyzes social media posts for sentiment',
            totalAnalyses: this.analysisHistory.length
        };
    }
}

// Singleton instance creation
const socialSentimentAnalyzer = new SocialSentimentAnalyzer();

// Legacy function compatibility
function analyzeSocialSentiment(post) {
    return socialSentimentAnalyzer.analyzeSentiment(post);
}

module.exports = { 
    SocialSentimentAnalyzer,
    socialSentimentAnalyzer,
    analyzeSocialSentiment
};