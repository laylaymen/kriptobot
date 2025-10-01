/**
 * LIVIA Simple Debug Test
 * Nerede hata olduğunu bulmak için basit test
 */

console.log('1. Starting debug test...');

try {
    console.log('2. Attempting to require LIVIAOrchestrator...');
    const LIVIAOrchestrator = require('./modules/livia/liviaOrchestrator');
    console.log('3. LIVIAOrchestrator loaded successfully');
    
    console.log('4. Creating instance...');
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
    console.log('5. Instance created successfully');
    
    console.log('6. Attempting initialization...');
    
    const logger = {
        info: (msg) => console.log(`INFO: ${msg}`),
        error: (msg, error) => {
            console.log(`ERROR: ${msg}`);
            if (error) console.log('Error details:', error);
        },
        warn: (msg) => console.log(`WARN: ${msg}`)
    };
    
    livia.initialize(logger).then(result => {
        console.log('7. Initialization result:', result);
        
        if (result) {
            console.log('8. Getting status...');
            const status = livia.getStatus();
            console.log('Status:', JSON.stringify(status, null, 2));
            
            console.log('9. Shutting down...');
            livia.shutdown().then(() => {
                console.log('10. Test completed successfully!');
            });
        } else {
            console.log('8. Initialization failed');
        }
    }).catch(error => {
        console.log('7. Initialization error:', error);
    });
    
} catch (error) {
    console.log('ERROR during require/creation:', error);
}