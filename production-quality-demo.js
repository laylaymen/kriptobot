/**
 * Production Quality Guards - Demo and Integration
 * 
 * Demonstrates ExchangeRulesGuard + RateLimitOrchestrator integration
 * with Binance API and SimpleUMF
 */

const { SimpleUMF } = require('./kirpto bot sinyal/modules/simpleUMF');
const { ExchangeRulesGuard, FilterError } = require('./kirpto bot sinyal/modules/exchangeRulesGuard');
const { RateLimitOrchestrator, RateLimitError } = require('./kirpto bot sinyal/modules/rateLimitOrchestrator');
const axios = require('axios');

class ProductionQualityDemo {
    constructor() {
        this.umf = null;
        this.rulesGuard = new ExchangeRulesGuard();
        this.rateLimiter = new RateLimitOrchestrator({
            minBackoff: 1000,
            maxBackoff: 30000,
            backoffMultiplier: 2
        });
        
        this.stats = {
            validOrders: 0,
            invalidOrders: 0,
            filterViolations: {},
            apiRequests: 0,
            rateLimitHits: 0
        };
    }

    /**
     * Initialize production quality layer
     */
    async initialize() {
        console.log('🔧 Initializing Production Quality Layer...\n');

        // 1. Load exchange rules with rate limiting
        console.log('1️⃣ Loading exchange rules...');
        await this.loadExchangeRules();

        // 2. Initialize UMF with production guards
        console.log('\n2️⃣ Initializing UMF with guards...');
        this.umf = new SimpleUMF();
        // SimpleUMF doesn't need explicit initialization, it auto-starts

        console.log('\n✅ Production Quality Layer initialized!\n');
    }

    /**
     * Load and cache exchange rules from Binance
     */
    async loadExchangeRules() {
        try {
            const response = await this.rateLimiter.scheduleRequest({
                method: 'GET',
                url: 'https://api.binance.com/api/v3/exchangeInfo',
                timeout: 10000
            }, 'critical');

            await this.rulesGuard.loadRules(response.data);
            this.stats.apiRequests++;

            const guardStats = this.rulesGuard.getStats();
            console.log(`   ✅ Loaded rules for ${guardStats.symbolCount} symbols (${guardStats.rulesVersion})`);

        } catch (error) {
            if (error instanceof RateLimitError) {
                this.stats.rateLimitHits++;
                console.warn(`   ⚠️ Rate limit hit while loading rules: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Demo: Test various order scenarios
     */
    async demonstrateOrderValidation() {
        console.log('🧪 Testing Order Validation...\n');

        // Test cases: valid and invalid orders
        const testOrders = [
            // Valid orders
            {
                symbol: 'BTCUSDT',
                price: 50000.00,
                quantity: 0.001,
                side: 'BUY',
                type: 'LIMIT'
            },
            {
                symbol: 'ETHUSDT',
                price: 3000.50,
                quantity: 0.01,
                side: 'SELL',
                type: 'LIMIT'
            },
            // Invalid orders (price precision)
            {
                symbol: 'BTCUSDT',
                price: 50000.123,
                quantity: 0.001,
                side: 'BUY',
                type: 'LIMIT'
            },
            // Invalid orders (quantity too small)
            {
                symbol: 'BTCUSDT',
                price: 50000.00,
                quantity: 0.000001,
                side: 'BUY',
                type: 'LIMIT'
            },
            // Invalid orders (notional too small)
            {
                symbol: 'ADAUSDT',
                price: 0.50,
                quantity: 1.0,
                side: 'BUY',
                type: 'LIMIT'
            }
        ];

        for (const [index, order] of testOrders.entries()) {
            console.log(`📋 Test Order ${index + 1}: ${order.side} ${order.quantity} ${order.symbol} @ ${order.price}`);
            
            try {
                const validation = this.rulesGuard.validateOrder(order);
                
                if (validation.valid) {
                    console.log(`   ✅ Valid order`);
                    this.stats.validOrders++;
                    
                    if (validation.warnings.length > 0) {
                        console.log(`   ⚠️ Warnings: ${validation.warnings.join(', ')}`);
                    }
                } else {
                    console.log(`   ❌ Invalid order:`);
                    validation.errors.forEach(error => console.log(`      - ${error}`));
                    this.stats.invalidOrders++;
                    
                    // Track filter violations
                    validation.errors.forEach(error => {
                        const filterType = error.split(':')[0];
                        this.stats.filterViolations[filterType] = (this.stats.filterViolations[filterType] || 0) + 1;
                    });
                }

                // Show suggestions
                console.log(`   💡 Suggestions: price=${validation.suggestions.price}, qty=${validation.suggestions.quantity}, notional=${validation.suggestions.notional.toFixed(2)}`);

            } catch (error) {
                console.log(`   💥 Validation error: ${error.message}`);
            }
            
            console.log('');
        }
    }

    /**
     * Demo: Rate limit orchestrator with multiple requests
     */
    async demonstrateRateLimiting() {
        console.log('🚦 Testing Rate Limit Orchestrator...\n');

        const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'DOTUSDT'];
        const requests = [];

        // Create multiple concurrent requests with different priorities
        console.log('📡 Scheduling multiple API requests...');

        // Critical: Server time (highest priority)
        requests.push(
            this.makeRateLimitedRequest('GET', '/api/v3/time', {}, 'critical', 'Server time')
        );

        // High: Recent trades for active symbols
        for (const symbol of symbols.slice(0, 2)) {
            requests.push(
                this.makeRateLimitedRequest('GET', '/api/v3/trades', { symbol, limit: 100 }, 'high', `Recent trades ${symbol}`)
            );
        }

        // Normal: Klines for analysis
        for (const symbol of symbols.slice(0, 3)) {
            requests.push(
                this.makeRateLimitedRequest('GET', '/api/v3/klines', { 
                    symbol, 
                    interval: '1m', 
                    limit: 100 
                }, 'normal', `Klines ${symbol}`)
            );
        }

        // Low: 24hr ticker stats (lowest priority)
        requests.push(
            this.makeRateLimitedRequest('GET', '/api/v3/ticker/24hr', {}, 'low', '24hr ticker stats')
        );

        // Execute all requests
        console.log(`\n🚀 Executing ${requests.length} requests...\n`);
        
        const startTime = Date.now();
        const results = await Promise.allSettled(requests);
        const endTime = Date.now();

        // Analyze results
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        console.log(`\n📊 Rate Limiting Results:`);
        console.log(`   Total requests: ${requests.length}`);
        console.log(`   Successful: ${successful}`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Total time: ${endTime - startTime}ms`);

        // Show failed requests
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.log(`   ❌ Request ${index + 1} failed: ${result.reason.message}`);
            }
        });

        this.stats.apiRequests += requests.length;
    }

    /**
     * Make rate-limited API request
     */
    async makeRateLimitedRequest(method, endpoint, params, priority, description) {
        const baseURL = 'https://api.binance.com';
        const config = {
            method,
            url: baseURL + endpoint,
            params,
            timeout: 10000
        };

        try {
            console.log(`   🔄 [${priority.toUpperCase()}] ${description}`);
            const response = await this.rateLimiter.scheduleRequest(config, priority);
            console.log(`   ✅ [${priority.toUpperCase()}] ${description} - Success`);
            return response.data;
        } catch (error) {
            if (error instanceof RateLimitError) {
                this.stats.rateLimitHits++;
                console.log(`   🛑 [${priority.toUpperCase()}] ${description} - Rate limited`);
            } else {
                console.log(`   ❌ [${priority.toUpperCase()}] ${description} - Error: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Show live system statistics
     */
    showLiveStats() {
        console.log('\n📈 Live System Statistics:');
        
        // UMF stats
        if (this.umf) {
            const umfStats = this.umf.getStats();
            console.log(`\n   📡 UMF Stats:`);
            console.log(`      Events: ${umfStats.totalEvents || 0}`);
            console.log(`      Rate: ${umfStats.eventsPerSecond ? umfStats.eventsPerSecond.toFixed(1) : 0}/sec`);
            console.log(`      Errors: ${umfStats.totalErrors || 0}`);
            console.log(`      Active streams: ${umfStats.activeStreams || 0}`);
            console.log(`      Runtime: ${umfStats.runtime || 0}s`);
        }

        // Rules Guard stats
        const guardStats = this.rulesGuard.getStats();
        console.log(`\n   🛡️ Rules Guard Stats:`);
        console.log(`      Symbols: ${guardStats.symbolCount}`);
        console.log(`      Rules version: ${guardStats.rulesVersion}`);
        console.log(`      Age: ${guardStats.ageMinutes} minutes`);
        console.log(`      Is stale: ${guardStats.isStale}`);

        // Rate Limiter stats
        const rateLimiterStats = this.rateLimiter.getStats();
        console.log(`\n   🚦 Rate Limiter Stats:`);
        console.log(`      Total requests: ${rateLimiterStats.totalRequests}`);
        console.log(`      Success rate: ${(rateLimiterStats.successfulRequests / rateLimiterStats.totalRequests * 100 || 0).toFixed(1)}%`);
        console.log(`      Rate limit hits: ${rateLimiterStats.rateLimitHits}`);
        console.log(`      Backoff events: ${rateLimiterStats.backoffEvents}`);
        console.log(`      In backoff: ${rateLimiterStats.isInBackoff}`);
        console.log(`      Queue sizes: C:${rateLimiterStats.queues.critical} H:${rateLimiterStats.queues.high} N:${rateLimiterStats.queues.normal} L:${rateLimiterStats.queues.low}`);

        // Weight usage
        console.log(`\n   ⚖️ Rate Limits:`);
        console.log(`      Request Weight: ${rateLimiterStats.limits.requestWeight.current}/${rateLimiterStats.limits.requestWeight.max} (${rateLimiterStats.limits.requestWeight.percentage.toFixed(1)}%)`);
        console.log(`      Order Count: ${rateLimiterStats.limits.orderCount.current}/${rateLimiterStats.limits.orderCount.max} (${rateLimiterStats.limits.orderCount.percentage.toFixed(1)}%)`);
        console.log(`      Raw Requests: ${rateLimiterStats.limits.rawRequestCount.current}/${rateLimiterStats.limits.rawRequestCount.max} (${rateLimiterStats.limits.rawRequestCount.percentage.toFixed(1)}%)`);

        // Demo stats
        console.log(`\n   🧪 Demo Stats:`);
        console.log(`      Valid orders: ${this.stats.validOrders}`);
        console.log(`      Invalid orders: ${this.stats.invalidOrders}`);
        console.log(`      Filter violations:`, this.stats.filterViolations);
    }

    /**
     * Start live monitoring
     */
    startLiveMonitoring() {
        console.log('\n🔴 Starting live monitoring (Ctrl+C to stop)...\n');

        // Show stats every 10 seconds
        const statsInterval = setInterval(() => {
            console.clear();
            console.log('🏭 Production Quality Layer - Live Monitoring\n');
            this.showLiveStats();
        }, 10000);

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n\n🛑 Shutting down...');
            clearInterval(statsInterval);
            if (this.umf) this.umf.stop();
            this.rateLimiter.stop();
            process.exit(0);
        });
    }

    /**
     * Run full demonstration
     */
    async runDemo() {
        try {
            await this.initialize();
            await this.demonstrateOrderValidation();
            await this.demonstrateRateLimiting();
            this.showLiveStats();
            this.startLiveMonitoring();

        } catch (error) {
            console.error('❌ Demo failed:', error);
            process.exit(1);
        }
    }
}

// Run demo if called directly
if (require.main === module) {
    const demo = new ProductionQualityDemo();
    demo.runDemo();
}

module.exports = { ProductionQualityDemo };
