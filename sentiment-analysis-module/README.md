# Sentiment Analysis Module

## Overview
The Sentiment Analysis Module is designed to analyze various forms of text, including news articles, social media posts, and market indicators, to determine sentiment. It utilizes predefined word mappings and sophisticated algorithms to classify sentiment as positive, negative, or neutral, and suggests actions based on the analysis results.

## Features
- **News Sentiment Analysis**: Analyze news articles for sentiment using the `NewsSentimentAnalyzer` class.
- **Social Media Sentiment Analysis**: Evaluate social media posts with the `SocialSentimentAnalyzer` class, focusing on trends and language specific to social platforms.
- **Market Sentiment Analysis**: Assess market sentiment through financial news and indicators using the `MarketSentimentAnalyzer` class.
- **Batch Processing**: Analyze multiple news or social media items simultaneously with the `BatchAnalyzer` service.
- **Performance Tracking**: Monitor performance metrics, including analysis counts and average processing times.

## Installation
1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```
   cd sentiment-analysis-module
   ```
3. Install dependencies:
   ```
   npm install
   ```

## Usage
To use the sentiment analysis module, import the desired analyzer class and call its methods. For example:

```javascript
const { NewsSentimentAnalyzer } = require('./src/analyzers/newsSentimentAnalyzer');

const analyzer = new NewsSentimentAnalyzer();
const result = analyzer.analyzeSentiment('Market surges on positive news', 'Investors are optimistic about the future.');
console.log(result);
```

## Configuration
Configuration settings can be found in the `config` directory. Modify `sentimentConfig.json` and `moduleConfig.json` to adjust thresholds, mappings, and logging levels.

## Testing
Unit tests and integration tests are provided in the `tests` directory. To run the tests, use the following command:
```
npm test
```

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.