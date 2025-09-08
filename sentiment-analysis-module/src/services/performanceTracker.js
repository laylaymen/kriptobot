class PerformanceTracker {
    constructor() {
        this.performanceMetrics = {
            totalAnalysis: 0,
            totalProcessingTime: 0,
            avgProcessingTime: 0,
            analysisHistory: []
        };
    }

    /**
     * Track the performance of a sentiment analysis operation.
     * @param {number} processingTime - The time taken for the analysis in milliseconds.
     */
    trackAnalysis(processingTime) {
        this.performanceMetrics.totalAnalysis++;
        this.performanceMetrics.totalProcessingTime += processingTime;
        this.performanceMetrics.avgProcessingTime = this.performanceMetrics.totalProcessingTime / this.performanceMetrics.totalAnalysis;

        this.performanceMetrics.analysisHistory.push({
            timestamp: Date.now(),
            processingTime: processingTime
        });
    }

    /**
     * Get the current performance metrics.
     * @returns {Object} - The current performance metrics.
     */
    getMetrics() {
        return {
            totalAnalysis: this.performanceMetrics.totalAnalysis,
            avgProcessingTime: this.performanceMetrics.avgProcessingTime,
            analysisHistory: this.performanceMetrics.analysisHistory
        };
    }

    /**
     * Reset the performance metrics.
     */
    resetMetrics() {
        this.performanceMetrics = {
            totalAnalysis: 0,
            totalProcessingTime: 0,
            avgProcessingTime: 0,
            analysisHistory: []
        };
    }
}

module.exports = PerformanceTracker;