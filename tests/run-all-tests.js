#!/usr/bin/env node
/**
 * KRIPTOBOT Test Suite Runner
 * Tüm testleri organize bir şekilde çalıştırır
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class TestRunner {
    constructor() {
        this.testResults = [];
        this.startTime = Date.now();
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const colors = {
            info: '\x1b[36m',    // Cyan
            success: '\x1b[32m', // Green  
            error: '\x1b[31m',   // Red
            warning: '\x1b[33m'  // Yellow
        };
        console.log(`${colors[type]}[${timestamp}] ${message}\x1b[0m`);
    }

    async runTest(testFile, description) {
        this.log(`🧪 Test başlatılıyor: ${description}`);
        
        try {
            const result = execSync(`node "${testFile}"`, { 
                encoding: 'utf8',
                timeout: 30000 
            });
            
            this.testResults.push({
                file: testFile,
                description,
                status: 'PASSED',
                output: result
            });
            
            this.log(`✅ BAŞARILI: ${description}`, 'success');
            return true;
            
        } catch (error) {
            this.testResults.push({
                file: testFile,
                description,
                status: 'FAILED',
                error: error.message
            });
            
            this.log(`❌ BAŞARISIZ: ${description}`, 'error');
            return false;
        }
    }

    async runAllTests() {
        this.log('🚀 KRIPTOBOT Test Suite başlatılıyor...', 'info');

        const tests = [
            {
                file: path.join(__dirname, '../kirpto bot sinyal/quick-test.js'),
                description: 'Hızlı Sistem Kontrolü'
            },
            {
                file: path.join(__dirname, '../kirpto bot sinyal/modules/dataFetcher.test.js'),
                description: 'Veri Toplama Modülü'
            },
            {
                file: path.join(__dirname, 'debug-livia.js'),
                description: 'LIVIA AI Sistem Testi'
            }
        ];

        let passedTests = 0;
        let totalTests = tests.length;

        for (const test of tests) {
            if (fs.existsSync(test.file)) {
                const success = await this.runTest(test.file, test.description);
                if (success) passedTests++;
            } else {
                this.log(`⚠️ Test dosyası bulunamadı: ${test.file}`, 'warning');
            }
        }

        // Sonuç raporu
        const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);

        this.log('\n📊 TEST SONUÇLARI:', 'info');
        this.log(`✅ Başarılı: ${passedTests}/${totalTests} (%${successRate})`, 'success');
        this.log(`⏱️ Süre: ${duration} saniye`, 'info');
        
        if (passedTests === totalTests) {
            this.log('🎉 Tüm testler başarılı!', 'success');
            process.exit(0);
        } else {
            this.log('❌ Bazı testler başarısız!', 'error');
            process.exit(1);
        }
    }
}

// Test runner'ı başlat
if (require.main === module) {
    const runner = new TestRunner();
    runner.runAllTests().catch(console.error);
}

module.exports = TestRunner;