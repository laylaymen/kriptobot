class TextProcessor {
    /**
     * Normalizes the input text by converting it to lowercase and removing punctuation.
     * @param {string} text - The text to normalize.
     * @returns {string} - The normalized text.
     */
    static normalize(text) {
        return text.toLowerCase().replace(/[^\w\s]/g, '');
    }

    /**
     * Tokenizes the input text into an array of words.
     * @param {string} text - The text to tokenize.
     * @returns {Array<string>} - An array of words.
     */
    static tokenize(text) {
        return text.split(/\s+/).filter(word => word.length > 0);
    }

    /**
     * Cleans the input text by normalizing and tokenizing it.
     * @param {string} text - The text to clean.
     * @returns {Array<string>} - An array of cleaned words.
     */
    static clean(text) {
        const normalizedText = this.normalize(text);
        return this.tokenize(normalizedText);
    }
}

module.exports = TextProcessor;