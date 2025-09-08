class BatchAnalyzer {
    constructor() {
        this.results = [];
    }

    analyzeBatch(newsItems) {
        const aggregatedResults = {
            totalItems: newsItems.length,
            positiveCount: 0,
            negativeCount: 0,
            neutralCount: 0,
            avgSentimentScore: 0,
            overallSentiment: 'neutral'
        };

        newsItems.forEach(item => {
            const analysis = this.analyzeSentiment(item.title, item.description);
            this.results.push(analysis);

            if (analysis.sentimentTag === 'positive') {
                aggregatedResults.positiveCount++;
            } else if (analysis.sentimentTag === 'negative') {
                aggregatedResults.negativeCount++;
            } else {
                aggregatedResults.neutralCount++;
            }

            aggregatedResults.avgSentimentScore += analysis.sentimentScore;
        });

        if (newsItems.length > 0) {
            aggregatedResults.avgSentimentScore /= newsItems.length;
            aggregatedResults.overallSentiment = this.classifyOverallSentiment(aggregatedResults);
        }

        return {
            individualResults: this.results,
            aggregatedResults: aggregatedResults
        };
    }

    analyzeSentiment(title, description) {
        // Placeholder for actual sentiment analysis logic
        // This should call the appropriate sentiment analyzer
        return {
            title: title,
            sentimentScore: Math.random() * 2 - 1, // Random score for demonstration
            sentimentTag: Math.random() > 0.5 ? 'positive' : 'negative' // Random tag for demonstration
        };
    }

    classifyOverallSentiment(aggregatedResults) {
        if (aggregatedResults.positiveCount > aggregatedResults.negativeCount) {
            return 'positive';
        } else if (aggregatedResults.negativeCount > aggregatedResults.positiveCount) {
            return 'negative';
        }
        return 'neutral';
    }
}

module.exports = BatchAnalyzer;