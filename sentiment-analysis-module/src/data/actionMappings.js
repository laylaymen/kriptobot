const actionMappings = {
    positive: {
        high: {
            newsSentimentAnalyzer: 'increase investment',
            socialSentimentAnalyzer: 'amplify marketing efforts',
            marketSentimentAnalyzer: 'buy signals'
        },
        moderate: {
            newsSentimentAnalyzer: 'monitor developments',
            socialSentimentAnalyzer: 'engage with audience',
            marketSentimentAnalyzer: 'consider buying'
        }
    },
    negative: {
        high: {
            newsSentimentAnalyzer: 'sell immediately',
            socialSentimentAnalyzer: 'issue warnings',
            marketSentimentAnalyzer: 'liquidate positions'
        },
        moderate: {
            newsSentimentAnalyzer: 'review portfolio',
            socialSentimentAnalyzer: 'reduce exposure',
            marketSentimentAnalyzer: 'exercise caution'
        }
    },
    neutral: {
        any: {
            newsSentimentAnalyzer: 'maintain current strategy',
            socialSentimentAnalyzer: 'continue monitoring',
            marketSentimentAnalyzer: 'stay informed'
        }
    }
};

module.exports = actionMappings;