# 🚀 KRIPTOBOT Kurulum Kılavuzu

## 📥 İndirme Sonrası Kurulum

### 1️⃣ **ZIP Dosyasını Açın**
```bash
# Windows
# ZIP dosyasına çift tıklayın ve "Extract All" seçin

# macOS  
# ZIP dosyasına çift tıklayın

# Linux
unzip KRIPTOBOT-COMPLETE-WITH-ENV-20251001-1728.zip
```

### 2️⃣ **Klasöre Girin**
```bash
cd kriptobot
```

### 3️⃣ **Node.js Kurulu mu Kontrol Edin**
```bash
node --version
npm --version

# Kurulu değilse: https://nodejs.org adresinden indirin
```

### 4️⃣ **Bağımlılıkları Yükleyin**
```bash
npm install
# veya
pnpm install
```

### 5️⃣ **Çevre Değişkenlerini Ayarlayın**
```bash
# ENV kurulum wizard'ı çalıştır
node setup-env.js

# Veya manuel olarak .env dosyası oluşturun
cp .env.example .env
```

### 6️⃣ **API Anahtarlarını Şifreleyin**
```bash
# İnteraktif şifreleme aracı
node encrypt-api-keys.js
```

### 7️⃣ **Sistemi Başlatın**
```bash
# Test çalıştırması
node quick-test.js

# Ana sistem
node index.js
```

## 🔧 **Gerekli API Anahtarları**

### **Zorunlu:**
- `BINANCE_API_KEY` - Binance API
- `BINANCE_SECRET_KEY` - Binance Secret
- `TELEGRAM_BOT_TOKEN` - Telegram Bot
- `TELEGRAM_CHAT_ID` - Telegram Chat ID

### **İsteğe Bağlı:**
- `NEWS_API_KEY` - Haber analizi için
- `OPENAI_API_KEY` - AI analiz için

## 📞 **Destek**

### **Hata Alırsanız:**
1. `logs/` klasöründeki log dosyalarını kontrol edin
2. `node quick-test.js` ile test yapın
3. ENV ayarlarını kontrol edin

### **Test Komutları:**
```bash
# Bağımlılık kontrolü
npm test

# Modül testleri
node modules/dataFetcher.test.js

# Sistem entegrasyonu
node test-integration.js
```

---
**🎯 Kurulum tamamlandığında KRIPTOBOT kullanıma hazır olacak!**