/**
 * GB-U0 · unifiedMarketFeed.test.js
 * 
 * UnifiedMarketFeed modülü için test suite
 */

const { UnifiedMarketFeed, bus, ValidationHelpers } = require('./unifiedMarketFeed');

class UMFTester {
    constructor() {
        this.umf = new UnifiedMarketFeed();
        this.receivedMessages = new Map();
        this.testResults = [];
        this.startTime = Date.now();
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        const elapsed = Date.now() - this.startTime;
        console.log(`[${timestamp}] [${type}] [+${elapsed}ms] ${message}`);
    }

    success(test, message) {
        this.log(`✅ ${test}: ${message}`, 'PASS');
        this.testResults.push({ test, status: 'PASS', message });
    }

    fail(test, message, error = null) {
        this.log(`❌ ${test}: ${message}`, 'FAIL');
        if (error) {
            this.log(`   Error: ${error.message}`, 'ERROR');
        }
        this.testResults.push({ test, status: 'FAIL', message, error: error?.message });
    }

    info(message) {
        this.log(message, 'INFO');
    }

    // Test helper - belirli topic'ten mesaj gelene kadar bekle
    waitForMessage(topic, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for ${topic}`));
            }, timeout);

            const handler = (message) => {
                clearTimeout(timer);
                bus.off(topic, handler);
                resolve(message);
            };

            bus.once(topic, handler);
        });
    }

    // Test 1: Time Sync
    async testTimeSync() {
        try {
            this.info('Testing time synchronization...');
            const drift = await this.umf.timeSync();
            
            if (typeof drift === 'number') {
                this.success('Time Sync', `Drift: ${drift}ms`);
                
                if (Math.abs(drift) > 1000) {
                    this.fail('Time Sync Quality', `Large drift detected: ${drift}ms`);
                } else {
                    this.success('Time Sync Quality', `Acceptable drift: ${drift}ms`);
                }
            } else {
                this.fail('Time Sync', 'Invalid drift value returned');
            }
        } catch (error) {
            this.fail('Time Sync', 'Failed to sync time', error);
        }
    }

    // Test 2: Exchange Info Loading
    async testExchangeInfo() {
        try {
            this.info('Testing exchange info loading...');
            const symbols = ['BTCUSDT', 'ETHUSDT'];
            const rules = await this.umf.loadExchangeInfo(symbols);
            
            if (Object.keys(rules).length >= symbols.length) {
                this.success('Exchange Info', `Loaded rules for ${Object.keys(rules).length} symbols`);
                
                // Test specific symbol rules
                const btcRules = rules['BTCUSDT'];
                if (btcRules && btcRules.filters.price && btcRules.filters.lot) {
                    this.success('Rules Validation', 'BTCUSDT rules contain required filters');
                } else {
                    this.fail('Rules Validation', 'Missing required filters in BTCUSDT rules');
                }
            } else {
                this.fail('Exchange Info', 'Insufficient rules loaded');
            }
        } catch (error) {
            this.fail('Exchange Info', 'Failed to load exchange info', error);
        }
    }

    // Test 3: Validation Helpers
    testValidationHelpers() {
        try {
            this.info('Testing validation helpers...');
            
            // Test snapToTick
            const snappedPrice = ValidationHelpers.snapToTick('50123.456789', '0.01');
            if (snappedPrice === '50123.46') {
                this.success('Price Snapping', `Correctly snapped to: ${snappedPrice}`);
            } else {
                this.fail('Price Snapping', `Expected 50123.46, got ${snappedPrice}`);
            }

            // Test snapToStep
            const snappedQty = ValidationHelpers.snapToStep('1.23456789', '0.001');
            if (snappedQty === '1.234') {
                this.success('Quantity Snapping', `Correctly snapped to: ${snappedQty}`);
            } else {
                this.fail('Quantity Snapping', `Expected 1.234, got ${snappedQty}`);
            }

            // Test notional check
            const notionalOk = ValidationHelpers.checkNotional('50000', '0.1', '10');
            if (notionalOk === true) {
                this.success('Notional Check', 'Validation passed for valid notional');
            } else {
                this.fail('Notional Check', 'Should pass for valid notional');
            }

            const notionalFail = ValidationHelpers.checkNotional('50000', '0.0001', '10');
            if (notionalFail === false) {
                this.success('Notional Check Failed', 'Correctly rejected invalid notional');
            } else {
                this.fail('Notional Check Failed', 'Should fail for invalid notional');
            }

        } catch (error) {
            this.fail('Validation Helpers', 'Validation helper tests failed', error);
        }
    }

    // Test 4: Kline Stream
    async testKlineStream() {
        try {
            this.info('Testing kline stream...');
            
            // Start stream
            this.umf.streamKlines('BTCUSDT', '1m');
            
            // Wait for first candle
            const candle = await this.waitForMessage('umf.candle.BTCUSDT.1m', 10000);
            
            if (candle && candle.kind === 'candle') {
                this.success('Kline Stream', `Received candle: ${candle.c} @ ${new Date(candle.tsClose)}`);
                
                // Validate candle structure
                const requiredFields = ['symbol', 'interval', 'o', 'h', 'l', 'c', 'v'];
                const missingFields = requiredFields.filter(field => !candle[field]);
                
                if (missingFields.length === 0) {
                    this.success('Candle Structure', 'All required fields present');
                } else {
                    this.fail('Candle Structure', `Missing fields: ${missingFields.join(', ')}`);
                }
            } else {
                this.fail('Kline Stream', 'Invalid candle message received');
            }
        } catch (error) {
            this.fail('Kline Stream', 'Failed to receive kline data', error);
        }
    }

    // Test 5: Trade Stream  
    async testTradeStream() {
        try {
            this.info('Testing trade stream...');
            
            this.umf.streamAggTrades('BTCUSDT');
            
            const trade = await this.waitForMessage('umf.trade.BTCUSDT', 10000);
            
            if (trade && trade.kind === 'trade') {
                this.success('Trade Stream', `Received trade: ${trade.qty} @ ${trade.px}`);
                
                // Validate trade structure
                if (trade.px && trade.qty && typeof trade.isBuyerMaker === 'boolean') {
                    this.success('Trade Structure', 'All required fields present');
                } else {
                    this.fail('Trade Structure', 'Missing required trade fields');
                }
            } else {
                this.fail('Trade Stream', 'Invalid trade message received');
            }
        } catch (error) {
            this.fail('Trade Stream', 'Failed to receive trade data', error);
        }
    }

    // Test 6: Book Ticker Stream
    async testBookTickerStream() {
        try {
            this.info('Testing book ticker stream...');
            
            this.umf.streamBookTicker('BTCUSDT');
            
            const ticker = await this.waitForMessage('umf.ticker.BTCUSDT', 10000);
            
            if (ticker && ticker.kind === 'ticker') {
                this.success('Ticker Stream', `Received ticker: ${ticker.bidPx}/${ticker.askPx}`);
                
                // Validate spread
                const spread = parseFloat(ticker.askPx) - parseFloat(ticker.bidPx);
                if (spread > 0) {
                    this.success('Ticker Spread', `Valid spread: ${spread.toFixed(2)}`);
                } else {
                    this.fail('Ticker Spread', `Invalid spread: ${spread}`);
                }
            } else {
                this.fail('Ticker Stream', 'Invalid ticker message received');
            }
        } catch (error) {
            this.fail('Ticker Stream', 'Failed to receive ticker data', error);
        }
    }

    // Test 7: Orderbook Stream
    async testOrderbookStream() {
        try {
            this.info('Testing orderbook stream...');
            
            await this.umf.streamOrderbookL2('BTCUSDT');
            
            const book = await this.waitForMessage('umf.book.BTCUSDT', 15000);
            
            if (book && book.kind === 'book') {
                this.success('Orderbook Stream', `Received book with ${book.bids.length} bids, ${book.asks.length} asks`);
                
                // Validate book structure
                if (book.bids.length > 0 && book.asks.length > 0) {
                    const topBid = parseFloat(book.bids[0][0]);
                    const topAsk = parseFloat(book.asks[0][0]);
                    
                    if (topBid < topAsk) {
                        this.success('Book Integrity', `Valid spread: ${topBid} < ${topAsk}`);
                    } else {
                        this.fail('Book Integrity', `Invalid spread: ${topBid} >= ${topAsk}`);
                    }
                } else {
                    this.fail('Book Integrity', 'Empty bids or asks');
                }
            } else {
                this.fail('Orderbook Stream', 'Invalid book message received');
            }
        } catch (error) {
            this.fail('Orderbook Stream', 'Failed to receive orderbook data', error);
        }
    }

    // Test 8: Event Bus Performance
    testEventBusPerformance() {
        try {
            this.info('Testing event bus performance...');
            
            const messageCount = 1000;
            const startTime = Date.now();
            
            let receivedCount = 0;
            
            const handler = () => {
                receivedCount++;
                if (receivedCount === messageCount) {
                    const elapsed = Date.now() - startTime;
                    const throughput = Math.round((messageCount / elapsed) * 1000);
                    this.success('Event Bus Performance', `${throughput} msg/sec (${messageCount} messages in ${elapsed}ms)`);
                }
            };
            
            bus.on('test.performance', handler);
            
            // Send test messages
            for (let i = 0; i < messageCount; i++) {
                bus.emit('test.performance', { id: i, data: 'test' });
            }
            
            bus.off('test.performance', handler);
            
        } catch (error) {
            this.fail('Event Bus Performance', 'Performance test failed', error);
        }
    }

    // Test 9: Quick Start Integration - CONSERVATIVE
    async testQuickStart() {
        try {
            this.info('Testing quick start integration (CONSERVATIVE)...');
            
            const { quickStart } = require('./unifiedMarketFeed');
            
            const umfInstance = await quickStart(['ETHUSDT'], {
                intervals: ['5m'], // Single interval
                enableTrades: true,
                enableTicker: true,
                enableOrderbook: false, // Disabled
                enableFunding: false
            });
            
            if (umfInstance && umfInstance.getStatus().isInitialized) {
                this.success('Quick Start', 'Successfully initialized with quickStart (CONSERVATIVE)');
                
                // Test status
                const status = umfInstance.getStatus();
                this.success('Status Check', `Active streams: ${status.activeStreams.length} (conservative)`);
            } else {
                this.fail('Quick Start', 'Failed to initialize');
            }
        } catch (error) {
            this.fail('Quick Start', 'Quick start test failed', error);
        }
    }

    // Test 10: Error Handling
    async testErrorHandling() {
        try {
            this.info('Testing error handling...');
            
            // Test invalid symbol
            try {
                await this.umf.loadExchangeInfo(['INVALID_SYMBOL_XYZ']);
                this.fail('Error Handling', 'Should have failed for invalid symbol');
            } catch (error) {
                this.success('Error Handling', 'Correctly handled invalid symbol');
            }
            
            // Test rate limiting simulation
            const originalWeight = this.umf.requestWeight;
            // Bu test için rate limit'i düşük set edelim
            
        } catch (error) {
            this.fail('Error Handling', 'Error handling test failed', error);
        }
    }

    // Ana test runner
    async runAllTests() {
        this.info('🚀 Starting UnifiedMarketFeed Test Suite...');
        this.info('================================================');
        
        // Environment check
        if (!process.env.BINANCE_API_KEY) {
            this.info('⚠️ No BINANCE_API_KEY found - some tests may fail');
        }

        try {
            // Sıralı testler
            await this.testTimeSync();
            await this.testExchangeInfo();
            this.testValidationHelpers();
            
            // Stream testleri (paralel olabilir)
            await Promise.allSettled([
                this.testKlineStream(),
                this.testTradeStream(),
                this.testBookTickerStream(),
                this.testOrderbookStream()
            ]);
            
            // Performance ve integration testleri
            this.testEventBusPerformance();
            await this.testQuickStart();
            await this.testErrorHandling();
            
        } catch (error) {
            this.fail('Test Suite', 'Unexpected test suite error', error);
        }
        
        this.printResults();
    }

    // Test sonuçlarını yazdır
    printResults() {
        this.info('================================================');
        this.info('📊 Test Results Summary');
        this.info('================================================');
        
        const passed = this.testResults.filter(r => r.status === 'PASS').length;
        const failed = this.testResults.filter(r => r.status === 'FAIL').length;
        const total = this.testResults.length;
        
        this.info(`Total Tests: ${total}`);
        this.info(`Passed: ${passed} ✅`);
        this.info(`Failed: ${failed} ❌`);
        this.info(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
        
        if (failed > 0) {
            this.info('\n❌ Failed Tests:');
            this.testResults
                .filter(r => r.status === 'FAIL')
                .forEach(r => {
                    this.info(`  - ${r.test}: ${r.message}`);
                    if (r.error) this.info(`    Error: ${r.error}`);
                });
        }
        
        this.info('\n🏁 Test suite completed');
        
        // Cleanup
        this.umf.shutdown();
        
        return {
            total,
            passed,
            failed,
            successRate: (passed / total) * 100
        };
    }
}

// CLI test runner
if (require.main === module) {
    const tester = new UMFTester();
    
    tester.runAllTests()
        .then(results => {
            process.exit(results.failed > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error('❌ Test runner crashed:', error);
            process.exit(1);
        });
}

// Export for use in other test files
module.exports = {
    UMFTester,
    runQuickTest: async () => {
        const tester = new UMFTester();
        await tester.testTimeSync();
        await tester.testExchangeInfo();
        tester.testValidationHelpers();
        return tester.printResults();
    }
};
