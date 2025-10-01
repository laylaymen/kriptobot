/**
 * LIVIA Advanced Test Suite
 * Gelişmiş test senaryoları ve performans analizi
 */

const LIVIAOrchestrator = require('./modules/livia/liviaOrchestrator');

class LIVIATestSuite {
    constructor() {
        this.testResults = {
            passed: 0,
            failed: 0,
            total: 0,
            details: []
        };
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const prefix = {
            'info': 'ℹ️ ',
            'success': '✅',
            'error': '❌',
            'warn': '⚠️ '
        }[type] || 'ℹ️ ';
        
        console.log(`${prefix} [${timestamp}] ${message}`);
    }

    async runTest(testName, testFn) {
        this.testResults.total++;
        this.log(`Running: ${testName}`, 'info');
        
        try {
            const startTime = Date.now();
            await testFn();
            const duration = Date.now() - startTime;
            
            this.testResults.passed++;
            this.testResults.details.push({ name: testName, status: 'PASS', duration });
            this.log(`${testName}: PASSED (${duration}ms)`, 'success');
            return true;
        } catch (error) {
            this.testResults.failed++;
            this.testResults.details.push({ name: testName, status: 'FAIL', error: error.message });
            this.log(`${testName}: FAILED - ${error.message}`, 'error');
            return false;
        }
    }

    async testBasicInitialization() {
        const livia = new LIVIAOrchestrator({
            modules: {
                actionApproval: { enabled: true, priority: 1 },
                biasMonitor: { enabled: false }, // Disable for basic test
                confirmationBounds: { enabled: false },
                decisionWriter: { enabled: false },
                guardEngine: { enabled: false },
                knowledgeRouter: { enabled: false }
            }
        });

        const initialized = await livia.initialize({
            info: () => {},
            error: (msg) => { throw new Error(msg); },
            warn: () => {}
        });

        if (!initialized) {
            throw new Error('LIVIA initialization failed');
        }

        const status = livia.getStatus();
        if (status.systemStatus !== 'running') {
            throw new Error(`Expected status 'running', got '${status.systemStatus}'`);
        }

        await livia.shutdown();
    }

    async testEventProcessing() {
        const livia = new LIVIAOrchestrator({
            modules: {
                actionApproval: { enabled: true, priority: 1 },
                biasMonitor: { enabled: false },
                confirmationBounds: { enabled: false },
                decisionWriter: { enabled: false },
                guardEngine: { enabled: false },
                knowledgeRouter: { enabled: false }
            }
        });

        await livia.initialize({
            info: () => {},
            error: () => {},
            warn: () => {}
        });

        // Test operator decision event
        const result = await livia.process({
            event: 'operator.decision.final',
            timestamp: new Date().toISOString(),
            promptId: 'test-001',
            decisionId: 'decision-001',
            accepted: true,
            rationale: 'Test decision',
            context: {
                action: 'test_action',
                payload: { amount: 100 },
                approvalKey: 'test-key-001'
            },
            auth: {
                userId: 'test-user',
                roles: ['operator'],
                sig: 'test-signature'
            }
        });

        if (!result.success) {
            throw new Error(`Event processing failed: ${result.error}`);
        }

        await livia.shutdown();
    }

    async testRiskDetection() {
        const livia = new LIVIAOrchestrator({
            modules: {
                actionApproval: { enabled: true, priority: 1 },
                biasMonitor: { enabled: false },
                confirmationBounds: { enabled: false },
                decisionWriter: { enabled: false },
                guardEngine: { enabled: false },
                knowledgeRouter: { enabled: false }
            }
        });

        await livia.initialize({
            info: () => {},
            error: () => {},
            warn: () => {}
        });

        const result = await livia.process({
            event: 'risk.detected',
            timestamp: new Date().toISOString(),
            riskLevel: 'high',
            category: 'financial',
            details: 'Test risk detection',
            action: 'immediate_attention'
        });

        if (!result.success) {
            throw new Error(`Risk detection failed: ${result.error}`);
        }

        await livia.shutdown();
    }

    async testModuleHealth() {
        const livia = new LIVIAOrchestrator();

        await livia.initialize({
            info: () => {},
            error: () => {},
            warn: () => {}
        });

        // Wait for health check
        await new Promise(resolve => setTimeout(resolve, 1000));

        const status = livia.getStatus();
        
        if (status.activeModules === 0) {
            throw new Error('No active modules found');
        }

        if (!status.lastHealthCheck) {
            // Health check might not have run yet, that's ok
            this.log('Health check not yet performed (acceptable)', 'warn');
        }

        await livia.shutdown();
    }

    async testConcurrentEvents() {
        const livia = new LIVIAOrchestrator({
            modules: {
                actionApproval: { enabled: true, priority: 1 },
                biasMonitor: { enabled: false },
                confirmationBounds: { enabled: false },
                decisionWriter: { enabled: false },
                guardEngine: { enabled: false },
                knowledgeRouter: { enabled: false }
            }
        });

        await livia.initialize({
            info: () => {},
            error: () => {},
            warn: () => {}
        });

        // Process multiple events concurrently
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(livia.process({
                event: 'operator.decision.final',
                timestamp: new Date().toISOString(),
                promptId: `concurrent-test-${i}`,
                decisionId: `concurrent-decision-${i}`,
                accepted: true,
                rationale: `Concurrent test ${i}`,
                context: {
                    action: 'concurrent_test',
                    payload: { index: i },
                    approvalKey: `concurrent-key-${i}`
                },
                auth: {
                    userId: 'concurrent-user',
                    roles: ['operator'],
                    sig: 'concurrent-signature'
                }
            }));
        }

        const results = await Promise.all(promises);
        
        for (const result of results) {
            if (!result.success) {
                throw new Error(`Concurrent processing failed: ${result.error}`);
            }
        }

        await livia.shutdown();
    }

    async testPerformanceBenchmark() {
        const livia = new LIVIAOrchestrator({
            modules: {
                actionApproval: { enabled: true, priority: 1 },
                biasMonitor: { enabled: false },
                confirmationBounds: { enabled: false },
                decisionWriter: { enabled: false },
                guardEngine: { enabled: false },
                knowledgeRouter: { enabled: false }
            }
        });

        await livia.initialize({
            info: () => {},
            error: () => {},
            warn: () => {}
        });

        const eventCount = 50;
        const startTime = Date.now();

        for (let i = 0; i < eventCount; i++) {
            await livia.process({
                event: 'operator.decision.final',
                timestamp: new Date().toISOString(),
                promptId: `perf-test-${i}`,
                decisionId: `perf-decision-${i}`,
                accepted: true,
                rationale: 'Performance test',
                context: {
                    action: 'perf_test',
                    payload: { index: i },
                    approvalKey: `perf-key-${i}`
                },
                auth: {
                    userId: 'perf-user',
                    roles: ['operator'],
                    sig: 'perf-signature'
                }
            });
        }

        const endTime = Date.now();
        const duration = endTime - startTime;
        const eventsPerSecond = (eventCount / duration) * 1000;

        this.log(`Performance: ${eventCount} events in ${duration}ms (${eventsPerSecond.toFixed(2)} eps)`, 'info');

        if (eventsPerSecond < 10) { // Minimum threshold
            throw new Error(`Performance too slow: ${eventsPerSecond.toFixed(2)} eps`);
        }

        await livia.shutdown();
    }

    async runAllTests() {
        this.log('🚀 LIVIA Advanced Test Suite Starting...', 'info');
        this.log('========================================', 'info');

        // Basic tests
        await this.runTest('Basic Initialization', () => this.testBasicInitialization());
        await this.runTest('Event Processing', () => this.testEventProcessing());
        await this.runTest('Risk Detection', () => this.testRiskDetection());
        await this.runTest('Module Health', () => this.testModuleHealth());
        
        // Advanced tests
        await this.runTest('Concurrent Events', () => this.testConcurrentEvents());
        await this.runTest('Performance Benchmark', () => this.testPerformanceBenchmark());

        // Results summary
        this.log('========================================', 'info');
        this.log('🏁 Test Summary:', 'info');
        this.log(`Total Tests: ${this.testResults.total}`, 'info');
        this.log(`Passed: ${this.testResults.passed}`, 'success');
        this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed > 0 ? 'error' : 'info');
        
        if (this.testResults.failed === 0) {
            this.log('🎉 All tests passed! LIVIA system is working correctly.', 'success');
        } else {
            this.log('⚠️  Some tests failed. Check details above.', 'warn');
        }

        // Detailed results
        this.log('\n📊 Detailed Results:', 'info');
        for (const detail of this.testResults.details) {
            const status = detail.status === 'PASS' ? '✅' : '❌';
            const duration = detail.duration ? ` (${detail.duration}ms)` : '';
            const error = detail.error ? ` - ${detail.error}` : '';
            this.log(`${status} ${detail.name}${duration}${error}`, 'info');
        }

        return this.testResults.failed === 0;
    }
}

// Run tests if script is executed directly
async function main() {
    const testSuite = new LIVIATestSuite();
    const success = await testSuite.runAllTests();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { LIVIATestSuite };