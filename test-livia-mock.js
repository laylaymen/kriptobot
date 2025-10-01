/**
 * LIVIA Test - Mock Event Bus ve Logger ile
 * Basit test environment
 */

// Mock Event Bus
const mockEventBus = {
    subscribe: (pattern, handler) => {
        console.log(`📡 Event subscription: ${pattern}`);
        return { unsubscribe: () => {} };
    },
    publish: (eventType, data) => {
        console.log(`📤 Event published: ${eventType}`, data?.event || '');
    },
    subscribeToEvent: (eventType, handler, source) => {
        console.log(`📡 Event subscription: ${eventType} from ${source}`);
    },
    publishEvent: (eventType, data, source) => {
        console.log(`📤 Event published: ${eventType} from ${source}`);
    }
};

// Mock Logger
const mockLogger = {
    info: (msg) => console.log(`ℹ️  ${msg}`),
    error: (msg, error) => console.log(`❌ ${msg}`, error ? error.message || error : ''),
    warn: (msg) => console.log(`⚠️  ${msg}`)
};

// Mock Functions
const mockLogFunctions = {
    logInfo: mockLogger.info,
    logError: mockLogger.error,
    logEvent: (event, data) => console.log(`📝 Event logged: ${event}`)
};

// Module Cache Override - Mock'ları enjekte et
Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
    if (id.includes('modularEventStream')) {
        return { eventBus: mockEventBus };
    }
    if (id.includes('logs/logger')) {
        return mockLogFunctions;
    }
    return originalRequire.apply(this, arguments);
};

// LIVIA Core Test
async function testLIVIACore() {
    console.log('🚀 LIVIA Core Test (Mock Environment)\n');
    
    try {
        // LIVIA Orchestrator'ı test et
        const LIVIAOrchestrator = require('./modules/livia/liviaOrchestrator');
        
        const livia = new LIVIAOrchestrator({
            modules: {
                actionApproval: { enabled: true, priority: 1 },
                biasMonitor: { enabled: false, priority: 2 }, // Disable for simple test
                confirmationBounds: { enabled: false, priority: 1 },
                decisionWriter: { enabled: false, priority: 3 },
                guardEngine: { enabled: false, priority: 1 },
                knowledgeRouter: { enabled: false, priority: 2 }
            }
        });
        
        console.log('✅ LIVIA Orchestrator yüklendi');
        
        // Initialize
        const initialized = await livia.initialize(mockLogger);
        console.log(`🔄 Initialize result: ${initialized}`);
        
        // Status check
        const status = livia.getStatus();
        console.log('\n📊 LIVIA Status:');
        console.log(`- Name: ${status.name}`);
        console.log(`- Initialized: ${status.initialized}`);
        console.log(`- Active Modules: ${status.activeModules}`);
        console.log(`- System Status: ${status.systemStatus}`);
        
        // Test process function
        const testEvent = {
            event: 'operator.decision.test',
            timestamp: new Date().toISOString(),
            data: { test: true }
        };
        
        console.log('\n🧪 Testing process function...');
        const result = await livia.process(testEvent);
        console.log(`✅ Process result: ${result.success}`);
        
        // Shutdown
        await livia.shutdown();
        console.log('\n✅ LIVIA Core Test Completed Successfully!');
        
    } catch (error) {
        console.error('\n❌ LIVIA Core Test Failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Individual Module Test
async function testActionApprovalGateway() {
    console.log('\n🔒 Action Approval Gateway Test\n');
    
    try {
        const { ActionApprovalGateway } = require('./modules/livia/actionApprovalGateway');
        
        const gateway = new ActionApprovalGateway({
            security: { verifySignature: false } // Disable signature check for test
        });
        
        console.log('✅ ActionApprovalGateway loaded');
        
        const initialized = await gateway.initialize(mockLogger);
        console.log(`🔄 Initialize result: ${initialized}`);
        
        const status = gateway.getStatus();
        console.log('\n📊 Gateway Status:');
        console.log(`- Name: ${status.name}`);
        console.log(`- Initialized: ${status.initialized}`);
        console.log(`- Sentry Mode: ${status.sentryMode}`);
        
        await gateway.shutdown();
        console.log('\n✅ Action Approval Gateway Test Completed!');
        
    } catch (error) {
        console.error('\n❌ Action Approval Gateway Test Failed:', error.message);
    }
}

// Module Import Test
async function testModuleImports() {
    console.log('\n📦 Module Import Test\n');
    
    const modules = [
        'actionApprovalGateway',
        'biasAwarenessMonitor',
        'confirmationBounds',
        'decisionRationaleWriter',
        'guardQuestionEngine',
        'knowledgeRouter'
    ];
    
    for (const moduleName of modules) {
        try {
            const module = require(`./modules/livia/${moduleName}`);
            console.log(`✅ ${moduleName}: Loaded successfully`);
            
            // Check for class export
            const className = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
            const classNames = Object.keys(module).filter(key => 
                key.includes(className.replace('Gateway', 'Gateway').replace('Monitor', 'Monitor'))
            );
            
            if (classNames.length > 0) {
                console.log(`   📋 Exports: ${classNames.join(', ')}`);
            }
            
        } catch (error) {
            console.log(`❌ ${moduleName}: ${error.message}`);
        }
    }
}

// Run Tests
async function runAllTests() {
    console.log('🎯 LIVIA System Tests Starting...\n');
    console.log('=' .repeat(50));
    
    await testModuleImports();
    console.log('\n' + '=' .repeat(50));
    
    await testActionApprovalGateway();
    console.log('\n' + '=' .repeat(50));
    
    await testLIVIACore();
    console.log('\n' + '=' .repeat(50));
    
    console.log('\n🎉 All LIVIA Tests Completed!\n');
}

// Execute
if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = { testLIVIACore, testActionApprovalGateway, testModuleImports };