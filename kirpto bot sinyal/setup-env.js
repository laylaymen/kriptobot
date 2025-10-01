/**
 * ENV Setup Script - İlk kurulum için ENV sistemi hazırlama
 * Bu dosyayı çalıştırarak ENV sistemini kurabilirsiniz
 */

const EnvManager = require('./modules/envManager');
const crypto = require('crypto');

async function setupEnvironment() {
    console.log('🚀 Kriptobot ENV Kurulum Başlatılıyor...\n');

    const envManager = new EnvManager();

    // 1. .env dosyası var mı kontrol et
    if (!envManager.envExists()) {
        console.log('📄 .env dosyası bulunamadı, .env.example\'dan oluşturuluyor...');
        try {
            envManager.createFromExample();
        } catch (error) {
            console.error('❌ .env dosyası oluşturulamadı:', error.message);
            return;
        }
    } else {
        console.log('✅ .env dosyası mevcut');
    }

    // 2. Şifreleme anahtarı oluştur veya al
    let encryptionKey = process.env.ENCRYPTION_KEY;
    
    if (!encryptionKey) {
        console.log('🔑 Yeni şifreleme anahtarı oluşturuluyor...');
        encryptionKey = crypto.randomBytes(32).toString('hex');
        console.log(`🔐 Şifreleme Anahtarınız: ${encryptionKey}`);
        console.log('⚠️  Bu anahtarı güvenli bir yerde saklayın!\n');
    }

    envManager.setEncryptionKey(encryptionKey);

    // 3. Örnek şifreleme
    console.log('📝 Örnek API anahtarı şifreleme:');
    console.log('─'.repeat(50));
    
    try {
        // Örnek değerler (gerçek değerleri buraya yazabilirsiniz)
        const examples = {
            'SAMPLE_API_KEY': 'your_binance_api_key_here',
            'SAMPLE_SECRET': 'your_binance_secret_here',
            'SAMPLE_TOKEN': 'your_telegram_token_here'
        };

        for (const [key, value] of Object.entries(examples)) {
            const { encrypt } = require('./modules/envSecure');
            const encrypted = encrypt(value, encryptionKey);
            console.log(`${key}=${encrypted}`);
        }

    } catch (error) {
        console.error('❌ Şifreleme hatası:', error.message);
    }

    console.log('\n' + '─'.repeat(50));
    console.log('✅ ENV Kurulum Tamamlandı!');
    console.log('📋 Sonraki Adımlar:');
    console.log('   1. .env dosyasını açın');
    console.log('   2. Gerçek API anahtarlarınızı şifreleyin');
    console.log('   3. Şifreli değerleri .env dosyasına yapıştırın');
    console.log('   4. Bot\'u başlatın: node index.js\n');
}

// Script direkt çalıştırılırsa
if (require.main === module) {
    setupEnvironment().catch(console.error);
}

module.exports = setupEnvironment;