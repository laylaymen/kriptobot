class ConfidenceCalculator {
    /**
     * Calculates the confidence level of sentiment analysis based on matched words and scores.
     * @param {number} sentimentScore - The sentiment score calculated from the analysis.
     * @param {Array} matchedWords - An array of words that contributed to the sentiment score.
     * @returns {number} - A confidence level between 0 and 1.
     */
    static calculateConfidence(sentimentScore, matchedWords) {
        const baseConfidence = Math.abs(sentimentScore); // Base confidence based on sentiment score

        if (matchedWords && matchedWords.length > 0) {
            // More matched words increase confidence
            const wordBonus = Math.min(0.3, matchedWords.length * 0.1);
            return Math.min(1, baseConfidence + wordBonus);
        }

        return baseConfidence;
    }
}

module.exports = ConfidenceCalculator;