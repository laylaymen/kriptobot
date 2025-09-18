// GELİŞMİŞ News Sentiment Analyzer - Ek modüller.txt prompt'una göre geliştirildi
// Haber başlığı + açıklamasını analiz ederek duygu sınıflandırması yapar
// Offline word-score mapping ile çalışır, sistem entegrasyonu

/**
 * Enhanced News Sentiment Analyzer Module
 * Haber duygu analizi - Ek modüller.txt prompt'una göre implementasyon
 * Haber başlığı + açıklamasını analiz ederek duygu sınıflandırması yapar
 * Offline word-score mapping ile çalışır
 */
class NewsSentimentAnalyzer {
    constructor() {
        this.moduleName = 'newsSentimentAnalyzer';
        
        // Sentiment word mapping (ek modüller.txt'den)
        this.sentimentWords = {
            // Pozitif kelimeler (+2, +1)
            positive: {
                strong: ['ETF', 'approval', 'approved', 'pump', 'bull', 'surge', 'rally', 'moon', 'adoption', 'breakthrough'],
                moderate: ['good', 'positive', 'green', 'up', 'rise', 'gain', 'profit', 'success', 'win', 'bullish']
            },
            // Negatif kelimeler (-2, -1)
            negative: {
                strong: ['hack', 'hacked', 'collapse', 'crash', 'ban', 'banned', 'rug', 'scam', 'exploit', 'stolen'],
                moderate: ['down', 'fall', 'drop', 'loss', 'bear', 'red', 'decline', 'worry', 'concern', 'risk']
            },
            // Nötr kelimeler (0)
            neutral: ['stable', 'unchanged', 'flat', 'sideways', 'consolidation', 'waiting', 'analysis']
        };
        
        // Action suggestions mapping (ek modüller.txt format'ında)
        this.actionMappings = {
            positive: {
                high: {
                    grafikBeyni: 'volatility spike preparation',
                    VIVO: 'signal confirmation boost'
                },
                moderate: {
                    grafikBeyni: 'pattern validation',
                    VIVO: 'normal signal processing'
                }
            },
            negative: {
                high: {
                    LIVIA: 'sinyal baskı',
                    grafikBeyni: 'falseBreakFilter aktif et',
                    emergencySystem: 'risk monitoring'
                },
                moderate: {
                    LIVIA: 'emotional defense',
                    grafikBeyni: 'cautious analysis'
                }
            },
            neutral: {
                any: {
                    denetimAsistani: 'normal logging',
                    systems: 'continue monitoring'
                }
            }
        };
        
        this.analysisHistory = [];
        this.maxHistorySize = 100;
        
        // Performance metrics
        this.performanceMetrics = {
            totalAnalysis: 0,
            positiveCount: 0,
            negativeCount: 0,
            neutralCount: 0,
            avgSentimentScore: 0,
            avgAnalysisTime: 0
        };
    }

    /**
     * Ana sentiment analiz fonksiyonu - ek modüller.txt format'ında
     */
    analyzeSentiment(title, description = '') {
        const startTime = Date.now();
        
        try {
            // Input validation
            if (!title || typeof title !== 'string') {
                throw new Error('Invalid title provided');
            }
            
            // Text preprocessing
            const fullText = `${title.toLowerCase()} ${(description || '').toLowerCase()}`;
            const words = this.preprocessText(fullText);
            
            // Sentiment scoring
            const sentimentScore = this.calculateSentimentScore(words);
            
            // Sentiment classification
            const sentimentTag = this.classifySentiment(sentimentScore);
            
            // Reason analysis (matched words)
            const reasonAnalysis = this.analyzeReasons(words, sentimentScore);
            
            // Action suggestions
            const actionSuggestions = this.generateActionSuggestions(sentimentTag, sentimentScore);
            
            // Final result (ek modüller.txt format'ında)
            const result = {
                title: title,
                sentimentScore: this.roundScore(sentimentScore),
                sentimentTag: sentimentTag,
                reason: reasonAnalysis.matchedWords,
                actionSuggested: actionSuggestions,
                confidence: this.calculateConfidence(sentimentScore, reasonAnalysis),
                intensity: this.calculateIntensity(sentimentScore),
                recommendation: this.generateRecommendation(sentimentTag, sentimentScore),
                metadata: {
                    analysisTimestamp: Date.now(),
                    analysisTime: Date.now() - startTime,
                    wordCount: words.length,
                    wordAnalysis: reasonAnalysis.wordAnalysis,
                    scoreBreakdown: reasonAnalysis.scoreBreakdown
                }
            };
            
            // History ve metrics güncelleme
            this.updateHistory(result);
            this.updatePerformanceMetrics(result, startTime);
            
            return result;
            
        } catch (error) {
            console.error('Sentiment analysis error:', error.message);
            return this.getDefaultResult(title, description, error.message);
        }
    }

    /**
     * Text preprocessing
     */
    preprocessText(text) {
        // Lowercase, noktalama temizleme, kelime ayırma
        const cleanText = text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Noktalama işaretlerini kaldır
            .replace(/\s+/g, ' ') // Çoklu boşlukları tek boşluk yap
            .trim();
        
        return cleanText.split(' ').filter(word => word.length > 2); // 2 karakterden uzun kelimeler
    }

    /**
     * Sentiment score hesaplama
     */
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
        
        // Normalize score (-1 ile +1 arası)
        if (matchedWords === 0) return 0;
        
        const avgScore = totalScore / matchedWords;
        return Math.max(-1, Math.min(1, avgScore / 2)); // -1 ile +1 arası sınırla
    }

    /**
     * Kelime skorunu bulma
     */
    getWordScore(word) {
        // Pozitif strong kelimeler: +2
        if (this.sentimentWords.positive.strong.includes(word)) return 2;
        
        // Pozitif moderate kelimeler: +1
        if (this.sentimentWords.positive.moderate.includes(word)) return 1;
        
        // Negatif strong kelimeler: -2
        if (this.sentimentWords.negative.strong.includes(word)) return -2;
        
        // Negatif moderate kelimeler: -1
        if (this.sentimentWords.negative.moderate.includes(word)) return -1;
        
        // Nötr kelimeler: 0
        if (this.sentimentWords.neutral.includes(word)) return 0;
        
        // Bilinmeyen kelimeler: 0
        return 0;
    }

    /**
     * Sentiment sınıflandırma
     */
    classifySentiment(score) {
        if (score > 0.2) return 'positive';
        if (score < -0.2) return 'negative';
        return 'neutral';
    }

    /**
     * Neden analizi
     */
    analyzeReasons(words, sentimentScore) {
        const matchedWords = [];
        const wordAnalysis = [];
        const scoreBreakdown = { positive: 0, negative: 0, neutral: 0 };
        
        words.forEach(word => {
            const score = this.getWordScore(word);
            if (score !== 0) {
                const category = score > 0 ? 'positive' : (score < 0 ? 'negative' : 'neutral');
                const intensity = Math.abs(score) === 2 ? 'strong' : 'moderate';
                
                matchedWords.push(word);
                wordAnalysis.push({
                    word: word,
                    score: score,
                    category: category,
                    intensity: intensity
                });
                
                scoreBreakdown[category] += Math.abs(score);
            }
        });
        
        return {
            matchedWords: matchedWords,
            wordAnalysis: wordAnalysis,
            scoreBreakdown: scoreBreakdown,
            dominantCategory: this.getDominantCategory(scoreBreakdown)
        };
    }

    /**
     * Action suggestions oluşturma (ek modüller.txt format'ında)
     */
    generateActionSuggestions(sentimentTag, sentimentScore) {
        const intensity = Math.abs(sentimentScore) > 0.5 ? 'high' : 'moderate';
        const actionKey = sentimentTag === 'neutral' ? 'any' : intensity;
        
        const baseActions = this.actionMappings[sentimentTag]?.[actionKey] || {};
        
        // Sistem action suggestions
        const suggestions = {};
        
        if (sentimentTag === 'negative') {
            suggestions.livia = 'sinyal baskı';
            suggestions.grafikBeyni = 'falseBreakFilter aktif et';
        } else if (sentimentTag === 'positive') {
            suggestions.grafikBeyni = 'volatility spike guard';
            suggestions.vivo = 'signal confirmation boost';
        } else {
            suggestions.denetimAsistani = 'normal logging';
        }
        
        return suggestions;
    }

    /**
     * Confidence hesaplama
     */
    calculateConfidence(sentimentScore, reasonAnalysis) {
        const baseConfidence = Math.abs(sentimentScore); // 0-1 arası
        
        if (reasonAnalysis && reasonAnalysis.matchedWords.length > 0) {
            // Daha fazla eşleşen kelime = daha yüksek confidence
            const wordBonus = Math.min(0.3, reasonAnalysis.matchedWords.length * 0.1);
            return Math.min(1, baseConfidence + wordBonus);
        }
        
        return baseConfidence;
    }

    /**
     * Intensity hesaplama
     */
    calculateIntensity(sentimentScore) {
        const absScore = Math.abs(sentimentScore);
        
        if (absScore > 0.7) return 'very_high';
        if (absScore > 0.5) return 'high';
        if (absScore > 0.3) return 'moderate';
        if (absScore > 0.1) return 'low';
        return 'minimal';
    }

    /**
     * Recommendation oluşturma
     */
    generateRecommendation(sentimentTag, sentimentScore) {
        const intensity = this.calculateIntensity(sentimentScore);
        
        if (sentimentTag === 'positive') {
            if (intensity === 'very_high' || intensity === 'high') {
                return 'Güçlü pozitif sinyal - Volatilite artışına hazır ol';
            }
            return 'Pozitif haber etkisi - Normal işlem moduna devam';
        }
        
        if (sentimentTag === 'negative') {
            if (intensity === 'very_high' || intensity === 'high') {
                return 'Kritik negatif haber - LIVIA sinyal baskısı aktif et';
            }
            return 'Negatif haber - Dikkatli analiz gerekli';
        }
        
        return 'Nötr haber - Normal monitoring devam etsin';
    }

    /**
     * Batch sentiment analysis (çoklu haber)
     */
    analyzeBatchSentiment(newsItems) {
        const results = [];
        let totalScore = 0;
        let positiveCount = 0;
        let negativeCount = 0;
        let neutralCount = 0;
        
        newsItems.forEach(item => {
            const analysis = this.analyzeSentiment(item.title, item.description);
            results.push(analysis);
            
            totalScore += analysis.sentimentScore;
            
            if (analysis.sentimentTag === 'positive') positiveCount++;
            else if (analysis.sentimentTag === 'negative') negativeCount++;
            else neutralCount++;
        });
        
        const avgSentiment = newsItems.length > 0 ? totalScore / newsItems.length : 0;
        
        return {
            individual: results,
            aggregate: {
                totalItems: newsItems.length,
                avgSentimentScore: this.roundScore(avgSentiment),
                overallSentiment: this.classifySentiment(avgSentiment),
                distribution: {
                    positive: positiveCount,
                    negative: negativeCount,
                    neutral: neutralCount
                },
                dominantSentiment: this.getDominantSentiment(positiveCount, negativeCount, neutralCount),
                marketMood: this.calculateMarketMood(avgSentiment, results)
            }
        };
    }

    // Helper methods
    getDominantCategory(scoreBreakdown) {
        const maxScore = Math.max(scoreBreakdown.positive, scoreBreakdown.negative, scoreBreakdown.neutral);
        
        if (scoreBreakdown.positive === maxScore) return 'positive';
        if (scoreBreakdown.negative === maxScore) return 'negative';
        return 'neutral';
    }

    getDominantSentiment(positive, negative, neutral) {
        const max = Math.max(positive, negative, neutral);
        if (positive === max) return 'positive';
        if (negative === max) return 'negative';
        return 'neutral';
    }

    calculateMarketMood(avgSentiment, results) {
        const highIntensityNews = results.filter(r => 
            r.intensity === 'high' || r.intensity === 'very_high'
        );
        
        if (highIntensityNews.length > results.length * 0.3) {
            return avgSentiment > 0 ? 'euphoric' : 'panic';
        }
        
        if (avgSentiment > 0.3) return 'optimistic';
        if (avgSentiment < -0.3) return 'pessimistic';
        return 'neutral';
    }

    roundScore(score) {
        return Math.round(score * 100) / 100; // 2 decimal places
    }

    updateHistory(result) {
        this.analysisHistory.push({
            timestamp: result.metadata.analysisTimestamp,
            sentimentScore: result.sentimentScore,
            sentimentTag: result.sentimentTag,
            confidence: result.confidence,
            matchedWords: result.reason.length
        });
        
        if (this.analysisHistory.length > this.maxHistorySize) {
            this.analysisHistory = this.analysisHistory.slice(-this.maxHistorySize);
        }
    }

    updatePerformanceMetrics(result, startTime) {
        this.performanceMetrics.totalAnalysis++;
        this.performanceMetrics.avgAnalysisTime = 
            (this.performanceMetrics.avgAnalysisTime + (Date.now() - startTime)) / 2;
        
        if (result.sentimentTag === 'positive') this.performanceMetrics.positiveCount++;
        else if (result.sentimentTag === 'negative') this.performanceMetrics.negativeCount++;
        else this.performanceMetrics.neutralCount++;
        
        this.performanceMetrics.avgSentimentScore = 
            (this.performanceMetrics.avgSentimentScore + result.sentimentScore) / 2;
    }

    getDefaultResult(title, description, errorMessage) {
        return {
            title: title || '',
            sentimentScore: 0,
            sentimentTag: 'neutral',
            reason: [],
            actionSuggested: {},
            confidence: 0,
            intensity: 'minimal',
            recommendation: 'Sentiment analizi başarısız - manuel inceleme gerekli',
            error: errorMessage,
            metadata: {
                analysisTimestamp: Date.now(),
                analysisTime: 0,
                wordCount: 0,
                wordAnalysis: [],
                scoreBreakdown: { positive: 0, negative: 0, neutral: 0 }
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'NewsSentimentAnalyzer',
            version: '2.0.0',
            description: 'GELİŞMİŞ haber duygu analizi - Ek modüller.txt prompt\'una göre geliştirildi',
            supportedLanguages: ['en'],
            wordCategories: Object.keys(this.sentimentWords),
            totalWords: Object.values(this.sentimentWords).flat().length,
            performanceMetrics: this.performanceMetrics,
            analysisHistory: this.analysisHistory.length
        };
    }
}

// Singleton instance oluşturma
const newsSentimentAnalyzer = new NewsSentimentAnalyzer();

// Legacy function compatibility
function analyzeSentiment(title, description) {
    return newsSentimentAnalyzer.analyzeSentiment(title, description);
}

module.exports = { 
    NewsSentimentAnalyzer,
    newsSentimentAnalyzer,
    analyzeSentiment
};


