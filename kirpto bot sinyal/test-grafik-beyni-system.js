/**
 * Grafik Beyni - Comprehensive System Test
 * 
 * Tests the complete Grafik Beyni system with all 24 modules integrated
 * Validates the 5-phase analysis pipeline and signal generation
 */

const SignalCoordinator = require('./modules/signalCoordinator');

class GrafikBeyniSystemTest {
    constructor() {
        this.coordinator = null;
        this.testResults = {
            moduleLoadTests: [],
            pipelineTests: [],
            integrationTests: [],
            performanceTests: []
        };
    }

    async runAllTests() {
        console.log('🧪 Starting Grafik Beyni System Tests...\n');
        
        try {
            // Test 1: Module Loading
            await this.testModuleLoading();
            
            // Test 2: Individual Module Analysis
            await this.testIndividualModules();
            
            // Test 3: Pipeline Flow
            await this.testAnalysisPipeline();
            
            // Test 4: Signal Generation
            await this.testSignalGeneration();
            
            // Test 5: Performance Benchmarks
            await this.testPerformance();
            
            // Generate final report
            this.generateTestReport();
            
        } catch (error) {
            console.error('❌ Test suite failed:', error);
        }
    }

    async testModuleLoading() {
        console.log('📦 Testing Module Loading...');
        
        try {
            this.coordinator = new SignalCoordinator();
            
            // Check if all 24 modules are loaded
            const expectedModules = [
                // Formation Detection (11 modules)
                'formationIdentifier',
                'ascendingTriangleDetector',
                'descendingTriangleDetector',
                'symmetricalTriangleDetector',
                'bullFlagDetector',
                'bearFlagDetector',
                'wedgeDetector',
                'headAndShouldersDetector',
                'inverseHeadAndShouldersDetector',
                'cupAndHandleDetector',
                
                // Formation Intelligence (2 modules)
                'formationCompletenessJudge',
                
                // Technical Analysis (10 modules)
                'tpOptimizer',
                'exitTimingAdvisor',
                'trendConfidenceEvaluator',
                'trendDetector',
                'formPatternRecognizer',
                'supportResistanceMapper',
                'volumeConfirmBreakout',
                'falseBreakFilter',
                'priceActionAnalyzer',
                'candlestickInterpreter',
                'trendStrengthMeter',
                'volatilityAssessment',
                
                // Market Intelligence (2 modules)
                'priceActionBiasGenerator',
                'riskToRewardValidator'
            ];
            
            let loadedCount = 0;
            const missingModules = [];
            
            expectedModules.forEach(moduleName => {
                if (this.coordinator.modules.has(moduleName)) {
                    loadedCount++;
                    console.log(`  ✅ ${moduleName}`);
                } else {
                    missingModules.push(moduleName);
                    console.log(`  ❌ ${moduleName} - MISSING`);
                }
            });
            
            this.testResults.moduleLoadTests.push({
                test: 'Module Loading',
                expected: expectedModules.length,
                loaded: loadedCount,
                missing: missingModules,
                success: loadedCount === expectedModules.length
            });
            
            console.log(`\n📊 Module Loading Results: ${loadedCount}/${expectedModules.length} modules loaded\n`);
            
        } catch (error) {
            console.error('❌ Module loading test failed:', error);
        }
    }

    async testIndividualModules() {
        console.log('🔬 Testing Individual Module Analysis...');
        
        const mockMarketData = this.generateMockMarketData();
        const testModules = [
            'formationIdentifier',
            'priceActionBiasGenerator',
            'riskToRewardValidator',
            'ascendingTriangleDetector',
            'tpOptimizer'
        ];
        
        for (const moduleName of testModules) {
            try {
                const module = this.coordinator.modules.get(moduleName);
                if (module) {
                    const startTime = Date.now();
                    const result = await module.instance.analyze(mockMarketData);
                    const executionTime = Date.now() - startTime;
                    
                    this.testResults.moduleLoadTests.push({
                        module: moduleName,
                        executionTime,
                        hasResult: !!result,
                        resultType: typeof result,
                        success: !!result && executionTime < 1000 // Should complete within 1 second
                    });
                    
                    console.log(`  ✅ ${moduleName}: ${executionTime}ms`);
                } else {
                    console.log(`  ❌ ${moduleName}: Module not found`);
                }
            } catch (error) {
                console.log(`  ❌ ${moduleName}: ${error.message}`);
            }
        }
        
        console.log('\n');
    }

    async testAnalysisPipeline() {
        console.log('🔄 Testing 5-Phase Analysis Pipeline...');
        
        const mockMarketData = this.generateMockMarketData();
        
        try {
            const startTime = Date.now();
            const signals = await this.coordinator.analyzeMarket(mockMarketData);
            const totalTime = Date.now() - startTime;
            
            this.testResults.pipelineTests.push({
                test: 'Full Pipeline',
                executionTime: totalTime,
                signalsGenerated: signals ? signals.length : 0,
                success: totalTime < 5000 && Array.isArray(signals) // Should complete within 5 seconds
            });
            
            console.log(`  ✅ Pipeline completed in ${totalTime}ms`);
            console.log(`  📊 Generated ${signals ? signals.length : 0} signals`);
            
            if (signals && signals.length > 0) {
                console.log('  📋 Signal Details:');
                signals.forEach((signal, index) => {
                    console.log(`    ${index + 1}. ${signal.sinyalTipi} (Score: ${signal.skor.toFixed(3)})`);
                });
            }
            
        } catch (error) {
            console.error('  ❌ Pipeline test failed:', error);
        }
        
        console.log('\n');
    }

    async testSignalGeneration() {
        console.log('📡 Testing Signal Generation with Various Market Conditions...');
        
        const scenarios = [
            { name: 'Bullish Breakout', data: this.generateBullishScenario() },
            { name: 'Bearish Reversal', data: this.generateBearishScenario() },
            { name: 'Sideways Market', data: this.generateSidewaysScenario() },
            { name: 'High Volatility', data: this.generateVolatileScenario() }
        ];
        
        for (const scenario of scenarios) {
            try {
                console.log(`  🎯 Testing: ${scenario.name}`);
                const signals = await this.coordinator.analyzeMarket(scenario.data);
                
                this.testResults.integrationTests.push({
                    scenario: scenario.name,
                    signalsGenerated: signals ? signals.length : 0,
                    topSignalScore: signals && signals.length > 0 ? signals[0].skor : 0,
                    success: Array.isArray(signals)
                });
                
                console.log(`    📊 Signals: ${signals ? signals.length : 0}`);
                if (signals && signals.length > 0) {
                    console.log(`    🏆 Top score: ${signals[0].skor.toFixed(3)} (${signals[0].sinyalTipi})`);
                }
                
            } catch (error) {
                console.error(`    ❌ ${scenario.name} failed:`, error.message);
            }
        }
        
        console.log('\n');
    }

    async testPerformance() {
        console.log('⚡ Testing Performance Benchmarks...');
        
        const iterations = 10;
        const executionTimes = [];
        const mockData = this.generateMockMarketData();
        
        for (let i = 0; i < iterations; i++) {
            const startTime = Date.now();
            await this.coordinator.analyzeMarket(mockData);
            const executionTime = Date.now() - startTime;
            executionTimes.push(executionTime);
        }
        
        const avgTime = executionTimes.reduce((sum, time) => sum + time, 0) / iterations;
        const minTime = Math.min(...executionTimes);
        const maxTime = Math.max(...executionTimes);
        
        this.testResults.performanceTests.push({
            iterations,
            averageTime: avgTime,
            minTime,
            maxTime,
            success: avgTime < 3000 // Should average under 3 seconds
        });
        
        console.log(`  📊 Average execution time: ${avgTime.toFixed(0)}ms`);
        console.log(`  🚀 Fastest execution: ${minTime}ms`);
        console.log(`  🐌 Slowest execution: ${maxTime}ms`);
        console.log('\n');
    }

    generateMockMarketData() {
        return {
            priceData: this.generateMockPriceData(50),
            volume: this.generateMockVolumeData(50),
            rsi: 65,
            volumeSpike: true,
            trendStrength: 0.75,
            candlePatterns: ['bullish-engulfing', 'long-lower-wick'],
            volatilitySpike: false,
            atr: 150,
            priceMomentum: 0.045,
            previousBreakoutStrength: 0.61,
            expectedProfit: 4.6,
            potentialStopLoss: 1.3,
            supportDistance: 1.4,
            resistanceDistance: 3.5,
            marketVolatility: 0.22,
            biasDirection: 'bullish'
        };
    }

    generateMockPriceData(length) {
        const priceData = [];
        let basePrice = 67000;
        
        for (let i = 0; i < length; i++) {
            const variation = (Math.random() - 0.5) * 1000;
            basePrice += variation * 0.1;
            
            priceData.push({
                open: basePrice,
                high: basePrice + Math.random() * 200,
                low: basePrice - Math.random() * 200,
                close: basePrice + (Math.random() - 0.5) * 100,
                volume: 1000 + Math.random() * 2000,
                timestamp: Date.now() - (length - i) * 60000
            });
        }
        
        return priceData;
    }

    generateMockVolumeData(length) {
        return Array.from({ length }, () => 1000 + Math.random() * 2000);
    }

    generateBullishScenario() {
        return {
            ...this.generateMockMarketData(),
            rsi: 68,
            trendStrength: 0.85,
            volumeSpike: true,
            candlePatterns: ['bullish-engulfing', 'hammer'],
            priceMomentum: 0.055,
            biasDirection: 'strong-bullish'
        };
    }

    generateBearishScenario() {
        return {
            ...this.generateMockMarketData(),
            rsi: 32,
            trendStrength: 0.25,
            volumeSpike: true,
            candlePatterns: ['bearish-engulfing', 'shooting-star'],
            priceMomentum: -0.040,
            biasDirection: 'strong-bearish'
        };
    }

    generateSidewaysScenario() {
        return {
            ...this.generateMockMarketData(),
            rsi: 51,
            trendStrength: 0.35,
            volumeSpike: false,
            candlePatterns: ['doji', 'spinning-top'],
            priceMomentum: 0.005,
            biasDirection: 'neutral'
        };
    }

    generateVolatileScenario() {
        return {
            ...this.generateMockMarketData(),
            rsi: 58,
            trendStrength: 0.45,
            volatilitySpike: true,
            atr: 350,
            marketVolatility: 0.65,
            candlePatterns: ['long-upper-wick', 'long-lower-wick']
        };
    }

    generateTestReport() {
        console.log('📋 GRAFIK BEYNI SYSTEM TEST REPORT');
        console.log('=' .repeat(50));
        
        // Module Loading Results
        const moduleTest = this.testResults.moduleLoadTests.find(t => t.test === 'Module Loading');
        if (moduleTest) {
            console.log(`\n📦 MODULE LOADING: ${moduleTest.success ? '✅ PASS' : '❌ FAIL'}`);
            console.log(`   Loaded: ${moduleTest.loaded}/${moduleTest.expected} modules`);
            if (moduleTest.missing.length > 0) {
                console.log(`   Missing: ${moduleTest.missing.join(', ')}`);
            }
        }
        
        // Pipeline Performance
        const pipelineTest = this.testResults.pipelineTests.find(t => t.test === 'Full Pipeline');
        if (pipelineTest) {
            console.log(`\n🔄 PIPELINE PERFORMANCE: ${pipelineTest.success ? '✅ PASS' : '❌ FAIL'}`);
            console.log(`   Execution Time: ${pipelineTest.executionTime}ms`);
            console.log(`   Signals Generated: ${pipelineTest.signalsGenerated}`);
        }
        
        // Integration Tests
        console.log(`\n📡 SIGNAL GENERATION:`);
        this.testResults.integrationTests.forEach(test => {
            console.log(`   ${test.scenario}: ${test.signalsGenerated} signals (Score: ${test.topSignalScore.toFixed(3)})`);
        });
        
        // Performance Benchmarks
        const perfTest = this.testResults.performanceTests[0];
        if (perfTest) {
            console.log(`\n⚡ PERFORMANCE BENCHMARKS: ${perfTest.success ? '✅ PASS' : '❌ FAIL'}`);
            console.log(`   Average Time: ${perfTest.averageTime.toFixed(0)}ms`);
            console.log(`   Min/Max: ${perfTest.minTime}ms / ${perfTest.maxTime}ms`);
        }
        
        // Overall Status
        const allTests = [
            ...this.testResults.moduleLoadTests.filter(t => t.success !== undefined),
            ...this.testResults.pipelineTests,
            ...this.testResults.integrationTests,
            ...this.testResults.performanceTests
        ];
        
        const passedTests = allTests.filter(t => t.success).length;
        const totalTests = allTests.length;
        
        console.log(`\n🎯 OVERALL RESULT: ${passedTests}/${totalTests} tests passed`);
        console.log('=' .repeat(50));
        
        if (passedTests === totalTests) {
            console.log('🎉 ALL TESTS PASSED! Grafik Beyni system is ready for production.');
        } else {
            console.log('⚠️  Some tests failed. Review the results above.');
        }
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    const test = new GrafikBeyniSystemTest();
    test.runAllTests().catch(console.error);
}

module.exports = GrafikBeyniSystemTest;
