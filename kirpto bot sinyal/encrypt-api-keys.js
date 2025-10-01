#!/usr/bin/env node
/**
 * ENV Encryption Tool - API anahtarlarını şifreleme aracı
 * Kullanım: node encrypt-api-keys.js
 */

const readline = require('readline');
const crypto = require('crypto');
const { encrypt } = require('./modules/envSecure');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function encryptApiKeys() {
    console.log('🔐 Kriptobot API Anahtarı Şifreleme Aracı');
    console.log('═'.repeat(50));

    try {
        // Şifreleme anahtarı al
        let encryptionKey = await question('Şifreleme anahtarınızı girin (64 karakter hex): ');
        
        if (!encryptionKey || encryptionKey.length !== 64) {
            console.log('\n🔑 Yeni anahtar oluşturuluyor...');
            encryptionKey = crypto.randomBytes(32).toString('hex');
            console.log(`Yeni anahtarınız: ${encryptionKey}`);
            console.log('⚠️  Bu anahtarı kaydedin!\n');
        }

        console.log('\n📝 API Anahtarlarınızı şifreleyelim:');
        console.log('─'.repeat(30));

        const keys = [
            'Binance API Key',
            'Binance Secret Key', 
            'NewsAPI Key',
            'Telegram Bot Token',
            'Telegram Chat ID'
        ];

        const results = {};

        for (const keyName of keys) {
            const value = await question(`${keyName}: `);
            if (value && value.trim()) {
                const encrypted = encrypt(value.trim(), encryptionKey);
                results[keyName] = encrypted;
            }
        }

        console.log('\n✅ Şifreli Değerler:');
        console.log('═'.repeat(50));
        console.log('# Bu değerleri .env dosyanıza kopyalayın:\n');

        const envMapping = {
            'Binance API Key': 'BINANCE_API_KEY',
            'Binance Secret Key': 'BINANCE_SECRET_KEY',
            'NewsAPI Key': 'NEWSAPI_KEY', 
            'Telegram Bot Token': 'TELEGRAM_BOT_TOKEN',
            'Telegram Chat ID': 'TELEGRAM_CHAT_ID'
        };

        for (const [keyName, encrypted] of Object.entries(results)) {
            const envVar = envMapping[keyName];
            console.log(`${envVar}=${encrypted}`);
        }

        console.log(`\nENCRYPTION_KEY=${encryptionKey}`);
        console.log('\n⚠️  Şifreleme anahtarını güvenli saklayın!');

    } catch (error) {
        console.error('❌ Hata:', error.message);
    } finally {
        rl.close();
    }
}

if (require.main === module) {
    encryptApiKeys();
}

module.exports = encryptApiKeys;