const { newsSentimentAnalyzer } = require('../../src/analyzers/newsSentimentAnalyzer');

describe('NewsSentimentAnalyzer', () => {
    test('should analyze positive sentiment correctly', () => {
        const title = 'Major ETF Approval Boosts Market';
        const description = 'The recent approval of a major ETF has led to a surge in market confidence.';
        const result = newsSentimentAnalyzer.analyzeSentiment(title, description);
        
        expect(result.sentimentTag).toBe('positive');
        expect(result.sentimentScore).toBeGreaterThan(0);
        expect(result.actionSuggested).toHaveProperty('grafikBeyni');
    });

    test('should analyze negative sentiment correctly', () => {
        const title = 'Crypto Exchange Hacked';
        const description = 'A major crypto exchange has been hacked, causing significant losses.';
        const result = newsSentimentAnalyzer.analyzeSentiment(title, description);
        
        expect(result.sentimentTag).toBe('negative');
        expect(result.sentimentScore).toBeLessThan(0);
        expect(result.actionSuggested).toHaveProperty('livia');
    });

    test('should analyze neutral sentiment correctly', () => {
        const title = 'Market Stays Stable';
        const description = 'The market remains unchanged with no significant movements.';
        const result = newsSentimentAnalyzer.analyzeSentiment(title, description);
        
        expect(result.sentimentTag).toBe('neutral');
        expect(result.sentimentScore).toBe(0);
        expect(result.actionSuggested).toHaveProperty('denetimAsistani');
    });

    test('should handle invalid input gracefully', () => {
        const result = newsSentimentAnalyzer.analyzeSentiment(null);
        
        expect(result.sentimentTag).toBe('neutral');
        expect(result.error).toBe('Invalid title provided');
    });

    test('should analyze batch sentiment correctly', () => {
        const newsItems = [
            { title: 'Bull Market Ahead', description: 'Analysts predict a bullish trend.' },
            { title: 'Market Crash Imminent', description: 'Concerns over a potential crash are rising.' },
            { title: 'Stable Market Conditions', description: 'The market shows stability with no major changes.' }
        ];
        const result = newsSentimentAnalyzer.analyzeBatchSentiment(newsItems);
        
        expect(result.aggregate.totalItems).toBe(newsItems.length);
        expect(result.aggregate.overallSentiment).toBe('neutral');
    });
});