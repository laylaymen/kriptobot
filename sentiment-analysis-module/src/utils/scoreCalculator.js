class ScoreCalculator {
    /**
     * Calculate sentiment score based on word occurrences.
     * @param {Array} words - Array of words from the analyzed text.
     * @param {Object} sentimentWords - Object containing sentiment word mappings.
     * @returns {number} - Calculated sentiment score normalized between -1 and 1.
     */
    static calculateScore(words, sentimentWords) {
        let score = 0;
        let matchedWords = 0;

        words.forEach(word => {
            const wordScore = this.getWordScore(word, sentimentWords);
            if (wordScore !== 0) {
                score += wordScore;
                matchedWords++;
            }
        });

        // Normalize score to -1..1
        return matchedWords > 0 ? Math.max(-1, Math.min(1, score / matchedWords)) : 0;
    }

    /**
     * Get the score for a specific word based on sentiment mappings.
     * @param {string} word - The word to evaluate.
     * @param {Object} sentimentWords - Object containing sentiment word mappings.
     * @returns {number} - Score for the word.
     */
    static getWordScore(word, sentimentWords) {
        // Positive strong words: +2
        if (sentimentWords.positive.strong.includes(word)) return 2;

        // Positive moderate words: +1
        if (sentimentWords.positive.moderate.includes(word)) return 1;

        // Negative strong words: -2
        if (sentimentWords.negative.strong.includes(word)) return -2;

        // Negative moderate words: -1
        if (sentimentWords.negative.moderate.includes(word)) return -1;

        // Neutral words: 0
        return 0;
    }
}

module.exports = ScoreCalculator;