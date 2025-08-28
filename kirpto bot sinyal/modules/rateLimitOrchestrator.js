/**
 * Rate Limit Orchestrator - Production Quality Layer
 * 
 * Global REST quota sharing and intelligent prioritization
 * Exponential backoff + queue management for API limits
 */

const EventEmitter = require('events');

class RateLimitOrchestrator extends EventEmitter {
    constructor(options = {}) {
        super(); // Call EventEmitter constructor
        
        this.limits = {
            // Binance default limits (per minute)
            requestWeight: { max: 1200, current: 0, window: 60000 },
            orderCount: { max: 10, current: 0, window: 10000 }, // 10 orders per 10s
            rawRequestCount: { max: 6000, current: 0, window: 300000 } // 6000 requests per 5min
        };

        this.queues = {
            critical: [], // snapshot, exchangeInfo, serverTime
            high: [],     // orderbook, recent trades
            normal: [],   // klines, 24hr stats
            low: []       // historical data, backfill
        };

        this.processing = false;
        this.backoffDelay = 0;
        this.minBackoff = options.minBackoff || 1000; // 1s
        this.maxBackoff = options.maxBackoff || 60000; // 60s
        this.backoffMultiplier = options.backoffMultiplier || 2;
        
        this.stats = {
            totalRequests: 0,
            rateLimitHits: 0,
            backoffEvents: 0,
            queueTimeouts: 0,
            successfulRequests: 0,
            failedRequests: 0
        };

        this.callbacks = new Map();
        this.requestId = 0;

        // Start processing loop
        this.startProcessing();
        
        // Reset counters periodically
        setInterval(() => this.resetCounters(), 60000); // Every minute
    }

    /**
     * Schedule API request with priority
     */
    async scheduleRequest(requestConfig, priority = 'normal', timeout = 30000) {
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            const request = {
                id,
                config: requestConfig,
                priority,
                timeout,
                createdAt: Date.now(),
                resolve,
                reject
            };

            // Set timeout
            const timeoutId = setTimeout(() => {
                this.removeFromQueue(id);
                this.stats.queueTimeouts++;
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);

            request.timeoutId = timeoutId;

            // Add to appropriate queue
            this.queues[priority].push(request);
            this.callbacks.set(id, { resolve, reject });

            console.log(`📊 Queued request ${id} (${priority}) - Queue sizes: C:${this.queues.critical.length} H:${this.queues.high.length} N:${this.queues.normal.length} L:${this.queues.low.length}`);
        });
    }

    /**
     * Remove request from queue by ID
     */
    removeFromQueue(requestId) {
        for (const priority of Object.keys(this.queues)) {
            const index = this.queues[priority].findIndex(req => req.id === requestId);
            if (index !== -1) {
                const request = this.queues[priority][index];
                if (request.timeoutId) {
                    clearTimeout(request.timeoutId);
                }
                this.queues[priority].splice(index, 1);
                this.callbacks.delete(requestId);
                return true;
            }
        }
        return false;
    }

    /**
     * Get next request from queues (priority order)
     */
    getNextRequest() {
        const priorities = ['critical', 'high', 'normal', 'low'];
        for (const priority of priorities) {
            if (this.queues[priority].length > 0) {
                return this.queues[priority].shift();
            }
        }
        return null;
    }

    /**
     * Check if we can make a request (under limits)
     */
    canMakeRequest(weight = 1) {
        const now = Date.now();
        
        // Check request weight limit
        if (this.limits.requestWeight.current + weight > this.limits.requestWeight.max) {
            return { allowed: false, reason: 'REQUEST_WEIGHT', remaining: this.limits.requestWeight.max - this.limits.requestWeight.current };
        }

        // Check raw request count
        if (this.limits.rawRequestCount.current >= this.limits.rawRequestCount.max) {
            return { allowed: false, reason: 'RAW_REQUEST_COUNT', remaining: 0 };
        }

        // Check if we're in backoff
        if (this.backoffDelay > 0) {
            return { allowed: false, reason: 'BACKOFF', backoffEndsAt: now + this.backoffDelay };
        }

        return { allowed: true };
    }

    /**
     * Estimate request weight from config
     */
    estimateWeight(config) {
        const { url, params = {} } = config;
        
        // Weight estimation based on endpoint patterns
        if (url.includes('/depth')) {
            const limit = params.limit || 100;
            return limit <= 100 ? 1 : limit <= 500 ? 5 : 10;
        }
        
        if (url.includes('/klines')) {
            const limit = params.limit || 500;
            return limit <= 100 ? 1 : limit <= 500 ? 2 : 5;
        }
        
        if (url.includes('/trades')) {
            return params.limit <= 500 ? 1 : 2;
        }
        
        if (url.includes('/exchangeInfo')) {
            return 10;
        }
        
        if (url.includes('/ticker/24hr')) {
            return Array.isArray(params.symbol) ? params.symbol.length : params.symbol ? 1 : 40;
        }

        // Default weight
        return 1;
    }

    /**
     * Update rate limits from response headers
     */
    updateLimitsFromHeaders(headers) {
        if (headers['x-mbx-used-weight']) {
            this.limits.requestWeight.current = parseInt(headers['x-mbx-used-weight']);
        }
        
        if (headers['x-mbx-used-weight-1m']) {
            this.limits.requestWeight.current = parseInt(headers['x-mbx-used-weight-1m']);
        }
        
        if (headers['x-mbx-order-count-10s']) {
            this.limits.orderCount.current = parseInt(headers['x-mbx-order-count-10s']);
        }

        // Log if approaching limits
        const weightPercent = (this.limits.requestWeight.current / this.limits.requestWeight.max) * 100;
        if (weightPercent > 80) {
            console.warn(`⚠️ Rate limit warning: ${weightPercent.toFixed(1)}% weight used (${this.limits.requestWeight.current}/${this.limits.requestWeight.max})`);
        }
    }

    /**
     * Handle rate limit hit - implement backoff
     */
    handleRateLimitHit(error, retryAfter = null) {
        this.stats.rateLimitHits++;
        this.stats.backoffEvents++;
        
        // Calculate backoff delay
        if (retryAfter) {
            this.backoffDelay = retryAfter * 1000; // Convert to ms
        } else {
            this.backoffDelay = Math.min(
                this.minBackoff * Math.pow(this.backoffMultiplier, this.stats.backoffEvents),
                this.maxBackoff
            );
        }

        // Emit rate limit hit event
        this.emit('rate_limit_hit', {
            limitType: 'unknown',
            current: 'N/A',
            max: 'N/A',
            retryAfter: retryAfter || this.backoffDelay / 1000,
            error: error.message
        });

        console.warn(`🛑 Rate limit hit! Backing off for ${this.backoffDelay}ms. Error: ${error.message}`);

        // Emit backoff start event
        this.emit('backoff_start', {
            duration: this.backoffDelay,
            attempt: this.stats.backoffEvents
        });

        // Schedule backoff reset
        setTimeout(() => {
            this.backoffDelay = 0;
            console.log(`✅ Backoff ended, resuming requests`);
            this.emit('backoff_end', {
                duration: this.backoffDelay
            });
        }, this.backoffDelay);
    }

    /**
     * Reset rate limit counters
     */
    resetCounters() {
        const now = Date.now();
        
        // Reset weight counter every minute
        if (now - this.limits.requestWeight.lastReset >= this.limits.requestWeight.window) {
            this.limits.requestWeight.current = 0;
            this.limits.requestWeight.lastReset = now;
        }
        
        // Reset order counter every 10 seconds
        if (now - this.limits.orderCount.lastReset >= this.limits.orderCount.window) {
            this.limits.orderCount.current = 0;
            this.limits.orderCount.lastReset = now;
        }
        
        // Reset raw request counter every 5 minutes
        if (now - this.limits.rawRequestCount.lastReset >= this.limits.rawRequestCount.window) {
            this.limits.rawRequestCount.current = 0;
            this.limits.rawRequestCount.lastReset = now;
        }
    }

    /**
     * Execute actual HTTP request
     */
    async executeRequest(config) {
        const axios = require('axios');
        
        try {
            const response = await axios(config);
            
            // Update limits from response headers
            this.updateLimitsFromHeaders(response.headers);
            
            this.stats.successfulRequests++;
            return response;
            
        } catch (error) {
            this.stats.failedRequests++;
            
            // Check if it's a rate limit error
            if (error.response && error.response.status === 429) {
                const retryAfter = error.response.headers['retry-after'];
                this.handleRateLimitHit(error, retryAfter);
                throw new RateLimitError('Rate limit exceeded', retryAfter);
            }
            
            // Check for weight exceeded (418)
            if (error.response && error.response.status === 418) {
                this.handleRateLimitHit(error);
                throw new RateLimitError('Request weight exceeded');
            }
            
            throw error;
        }
    }

    /**
     * Main processing loop
     */
    async startProcessing() {
        this.processing = true;
        
        while (this.processing) {
            try {
                const request = this.getNextRequest();
                
                if (!request) {
                    // No requests in queue, wait a bit
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }

                const weight = this.estimateWeight(request.config);
                const canMake = this.canMakeRequest(weight);
                
                if (!canMake.allowed) {
                    // Can't make request now, put it back in queue
                    this.queues[request.priority].unshift(request);
                    
                    // Wait based on reason
                    const waitTime = canMake.reason === 'BACKOFF' ? 
                        this.backoffDelay : 
                        Math.min(5000, 60000 / this.limits.requestWeight.max * weight);
                        
                    console.log(`⏸️ Delaying request due to ${canMake.reason}, waiting ${waitTime}ms`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // Execute the request
                console.log(`🚀 Executing request ${request.id} (weight: ${weight})`);
                
                try {
                    const response = await this.executeRequest(request.config);
                    
                    // Update counters
                    this.limits.requestWeight.current += weight;
                    this.limits.rawRequestCount.current += 1;
                    this.stats.totalRequests++;
                    
                    // Resolve the promise
                    if (request.timeoutId) clearTimeout(request.timeoutId);
                    request.resolve(response);
                    this.callbacks.delete(request.id);
                    
                } catch (error) {
                    // Reject the promise
                    if (request.timeoutId) clearTimeout(request.timeoutId);
                    request.reject(error);
                    this.callbacks.delete(request.id);
                    
                    // If it's a rate limit error, don't update counters
                    if (!(error instanceof RateLimitError)) {
                        this.limits.requestWeight.current += weight;
                        this.limits.rawRequestCount.current += 1;
                        this.stats.totalRequests++;
                    }
                }
                
            } catch (error) {
                console.error('Processing loop error:', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * Stop the orchestrator
     */
    stop() {
        this.processing = false;
        
        // Reject all pending requests
        for (const [id, callbacks] of this.callbacks) {
            callbacks.reject(new Error('Orchestrator stopped'));
        }
        this.callbacks.clear();
        
        // Clear all queues
        for (const priority of Object.keys(this.queues)) {
            this.queues[priority] = [];
        }
    }

    /**
     * Get orchestrator statistics
     */
    getStats() {
        const totalQueued = Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0);
        
        return {
            ...this.stats,
            limits: {
                requestWeight: {
                    current: this.limits.requestWeight.current,
                    max: this.limits.requestWeight.max,
                    percentage: (this.limits.requestWeight.current / this.limits.requestWeight.max) * 100
                },
                orderCount: {
                    current: this.limits.orderCount.current,
                    max: this.limits.orderCount.max,
                    percentage: (this.limits.orderCount.current / this.limits.orderCount.max) * 100
                },
                rawRequestCount: {
                    current: this.limits.rawRequestCount.current,
                    max: this.limits.rawRequestCount.max,
                    percentage: (this.limits.rawRequestCount.current / this.limits.rawRequestCount.max) * 100
                }
            },
            queues: {
                critical: this.queues.critical.length,
                high: this.queues.high.length,
                normal: this.queues.normal.length,
                low: this.queues.low.length,
                total: totalQueued
            },
            backoffDelay: this.backoffDelay,
            isInBackoff: this.backoffDelay > 0
        };
    }
}

/**
 * Custom error for rate limit violations
 */
class RateLimitError extends Error {
    constructor(message, retryAfter = null) {
        super(message);
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

module.exports = {
    RateLimitOrchestrator,
    RateLimitError
};
