class HistoryManager {
    constructor() {
        this.history = [];
        this.maxHistorySize = 100; // Maximum number of history entries to keep
    }

    /**
     * Adds a new analysis result to the history.
     * @param {Object} result - The result of the sentiment analysis.
     */
    addToHistory(result) {
        this.history.push(result);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift(); // Remove the oldest entry
        }
    }

    /**
     * Retrieves the entire history of analyses.
     * @returns {Array} - The history of sentiment analyses.
     */
    getHistory() {
        return this.history;
    }

    /**
     * Clears the entire history.
     */
    clearHistory() {
        this.history = [];
    }

    /**
     * Retrieves the most recent analysis result.
     * @returns {Object|null} - The most recent analysis result or null if history is empty.
     */
    getLatestResult() {
        return this.history.length > 0 ? this.history[this.history.length - 1] : null;
    }

    /**
     * Retrieves analysis results within a specified range.
     * @param {number} start - The starting index.
     * @param {number} end - The ending index.
     * @returns {Array} - The analysis results within the specified range.
     */
    getResultsInRange(start, end) {
        return this.history.slice(start, end);
    }
}

module.exports = HistoryManager;