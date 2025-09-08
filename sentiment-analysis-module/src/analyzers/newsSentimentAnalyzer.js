class NewsSentimentAnalyzer {
    constructor() {
        this.moduleName = 'newsSentimentAnalyzer';
        
        this.sentimentWords = {
            positive: {
                strong: ['ETF', 'approval', 'approved', 'pump', 'bull', 'surge', 'rally', 'moon', 'adoption', 'breakthrough'],
                moderate: ['good', 'positive', 'green', 'up', 'rise', 'gain', 'profit', 'success', 'win', 'bullish']
            },
            negative: {
                strong: ['hack', 'hacked', 'collapse', 'crash', 'ban', 'banned', 'rug', 'scam', 'exploit', 'stolen'],
                moderate: ['down', 'fall', 'drop', 'loss', 'bear', 'red', 'decline', 'worry', 'concern', 'risk']
            },
            neutral: ['stable', 'unchanged', 'flat', 'sideways', 'consolidation', 'waiting', 'analysis']
        };
        
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
        
        this.performanceMetrics = {
            totalAnalysis: 0,
            positiveCount: 0,
            negativeCount: 0,
            neutralCount: 0,
            avgSentimentScore: 0,
            avgAnalysisTime: 0
        };
    }

    analyzeSentiment(title, description = '') {
        const startTime = Date.now();
        
        try {
            if (!title || typeof title !== 'string') {
                throw new Error('Invalid title provided');
            }
            
            const fullText = `${title.toLowerCase()} ${(description || '').toLowerCase()}`;
            const words = this.preprocessText(fullText);
            const sentimentScore = this.calculateSentimentScore(words);
            const sentimentTag = this.classifySentiment(sentimentScore);
            const reasonAnalysis = this.analyzeReasons(words, sentimentScore);
            const actionSuggestions = this.generateActionSuggestions(sentimentTag, sentimentScore);
            
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
            
            this.updateHistory(result);
            this.updatePerformanceMetrics(result, startTime);
            
            return result;
            
        } catch (error) {
            console.error('Sentiment analysis error:', error.message);
            return this.getDefaultResult(title, description, error.message);
        }
    }

    preprocessText(text) {
        const cleanText = text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        return cleanText.split(' ').filter(word => word.length > 2);
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
        
        if (matchedWords === 0) return 0;
        
        const avgScore = totalScore / matchedWords;
        return Math.max(-1, Math.min(1, avgScore / 2));
    }

    getWordScore(word) {
        if (this.sentimentWords.positive.strong.includes(word)) return 2;
        if (this.sentimentWords.positive.moderate.includes(word)) return 1;
        if (this.sentimentWords.negative.strong.includes(word)) return -2;
        if (this.sentimentWords.negative.moderate.includes(word)) return -1;
        if (this.sentimentWords.neutral.includes(word)) return 0;
        return 0;
    }

    classifySentiment(score) {
        if (score > 0.2) return 'positive';
        if (score < -0.2) return 'negative';
        return 'neutral';
    }

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

    generateActionSuggestions(sentimentTag, sentimentScore) {
        const intensity = Math.abs(sentimentScore) > 0.5 ? 'high' : 'moderate';
        const actionKey = sentimentTag === 'neutral' ? 'any' : intensity;
        
        const baseActions = this.actionMappings[sentimentTag]?.[actionKey] || {};
        
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

    calculateConfidence(sentimentScore, reasonAnalysis) {
        const baseConfidence = Math.abs(sentimentScore);
        
        if (reasonAnalysis && reasonAnalysis.matchedWords.length > 0) {
            const wordBonus = Math.min(0.3, reasonAnalysis.matchedWords.length * 0.1);
            return Math.min(1, baseConfidence + wordBonus);
        }
        
        return baseConfidence;
    }

    calculateIntensity(sentimentScore) {
        const absScore = Math.abs(sentimentScore);
        
        if (absScore > 0.7) return 'very_high';
        if (absScore > 0.5) return 'high';
        if (absScore > 0.3) return 'moderate';
        if (absScore > 0.1) return 'low';
        return 'minimal';
    }

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

const newsSentimentAnalyzer = new NewsSentimentAnalyzer();

function analyzeSentiment(title, description) {
    return newsSentimentAnalyzer.analyzeSentiment(title, description);
}

module.exports = { 
    NewsSentimentAnalyzer,
    newsSentimentAnalyzer,
    analyzeSentiment
};