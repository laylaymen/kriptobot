/**
 * ENV Manager - Şifrelenmiş environment değişkenleri yöneticisi
 * Şifreli ENV değerlerini çözer ve process.env'e yükler
 */

const fs = require('fs');
const path = require('path');
const { decrypt } = require('./envSecure');

class EnvManager {
    constructor() {
        this.encryptionKey = null;
        this.envPath = path.join(__dirname, '../../.env');
        this.loadedVars = {};
    }

    /**
     * Şifreleme anahtarını ayarla
     */
    setEncryptionKey(key) {
        if (!key || key.length !== 64) {
            throw new Error('Encryption key must be 64 characters hex string');
        }
        this.encryptionKey = key;
    }

    /**
     * ENV dosyasını yükle ve şifreli değerleri çöz
     */
    loadEncryptedEnv() {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not set. Call setEncryptionKey() first.');
        }

        if (!fs.existsSync(this.envPath)) {
            console.warn('⚠️ .env dosyası bulunamadı. .env.example dosyasını kopyalayın.');
            return;
        }

        const envContent = fs.readFileSync(this.envPath, 'utf8');
        const lines = envContent.split('\n');

        for (const line of lines) {
            // Yorum satırlarını ve boş satırları atla
            if (line.trim().startsWith('#') || !line.trim()) {
                continue;
            }

            const [key, ...valueParts] = line.split('=');
            if (!key || valueParts.length === 0) {
                continue;
            }

            const value = valueParts.join('=');
            let processedValue = value;

            // Şifreli değerleri algıla (hex:hex formatında)
            if (this.isEncrypted(value)) {
                try {
                    processedValue = decrypt(value, this.encryptionKey);
                    console.log(`🔓 ${key} başarıyla şifresi çözüldü`);
                } catch (error) {
                    console.error(`❌ ${key} şifresi çözülemedi:`, error.message);
                    continue;
                }
            }

            // Process.env'e ekle
            process.env[key.trim()] = processedValue.trim();
            this.loadedVars[key.trim()] = processedValue.trim();
        }

        console.log(`✅ ${Object.keys(this.loadedVars).length} environment değişkeni yüklendi`);
    }

    /**
     * Değerin şifreli olup olmadığını kontrol et
     */
    isEncrypted(value) {
        // Şifreli değerler hex:hex formatında olur
        return /^[a-f0-9]+:[a-f0-9]+$/i.test(value.trim());
    }

    /**
     * Yeni bir değeri şifrele ve ENV dosyasına ekle
     */
    addEncryptedVar(key, value, overwrite = false) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not set');
        }

        if (process.env[key] && !overwrite) {
            throw new Error(`${key} zaten mevcut. Overwrite=true ile değiştirebilirsiniz.`);
        }

        const { encrypt } = require('./envSecure');
        const encryptedValue = encrypt(value, this.encryptionKey);

        // ENV dosyasına ekle
        const envLine = `${key}=${encryptedValue}\n`;
        fs.appendFileSync(this.envPath, envLine);

        // Process.env'e ekle
        process.env[key] = value;
        this.loadedVars[key] = value;

        console.log(`🔒 ${key} şifrelenip eklendi`);
    }

    /**
     * Yüklenen değişkenleri listele (şifrelenmiş olanları gizle)
     */
    listVars() {
        const vars = {};
        for (const [key, value] of Object.entries(this.loadedVars)) {
            if (key.includes('KEY') || key.includes('SECRET') || key.includes('TOKEN')) {
                vars[key] = '***masked***';
            } else {
                vars[key] = value;
            }
        }
        return vars;
    }

    /**
     * ENV dosyası var mı kontrol et
     */
    envExists() {
        return fs.existsSync(this.envPath);
    }

    /**
     * .env.example'dan .env oluştur
     */
    createFromExample() {
        const examplePath = path.join(__dirname, '../../.env.example');
        if (!fs.existsSync(examplePath)) {
            throw new Error('.env.example dosyası bulunamadı');
        }

        if (this.envExists()) {
            throw new Error('.env dosyası zaten mevcut');
        }

        fs.copyFileSync(examplePath, this.envPath);
        console.log('✅ .env dosyası .env.example\'dan oluşturuldu');
        console.log('⚠️ Gerçek değerlerinizi girin ve şifreleyin!');
    }
}

module.exports = EnvManager;