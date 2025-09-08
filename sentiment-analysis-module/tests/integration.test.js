const { newsSentimentAnalyzer } = require('../src/analyzers/newsSentimentAnalyzer');
const { socialSentimentAnalyzer } = require('../src/analyzers/socialSentimentAnalyzer');
const { marketSentimentAnalyzer } = require('../src/analyzers/marketSentimentAnalyzer');

describe('Integration Tests for Sentiment Analysis Module', () => {
    test('News Sentiment Analysis', () => {
        const title = 'Crypto ETF Approval';
        const description = 'The SEC has approved a new Bitcoin ETF, boosting market confidence.';
        const result = newsSentimentAnalyzer.analyzeSentiment(title, description);
        
        expect(result.sentimentTag).toBe('positive');
        expect(result.sentimentScore).toBeGreaterThan(0);
        expect(result.actionSuggested).toHaveProperty('grafikBeyni');
    });

    test('Social Sentiment Analysis', () => {
        const post = 'Bitcoin is going to the moon!';
        const result = socialSentimentAnalyzer.analyzeSentiment(post);
        
        expect(result.sentimentTag).toBe('positive');
        expect(result.sentimentScore).toBeGreaterThan(0);
        expect(result.actionSuggested).toHaveProperty('livia');
    });

    test('Market Sentiment Analysis', () => {
        const marketNews = 'Market crashes as Bitcoin drops below $30,000.';
        const result = marketSentimentAnalyzer.analyzeSentiment(marketNews);
        
        expect(result.sentimentTag).toBe('negative');
        expect(result.sentimentScore).toBeLessThan(0);
        expect(result.actionSuggested).toHaveProperty('grafikBeyni');
    });
});