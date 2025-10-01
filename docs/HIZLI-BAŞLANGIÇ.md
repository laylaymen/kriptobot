# 🚀 KRIPTOBOT Hızlı Başlangıç - 5 Dakikada Çalıştır!

## ⚡ 1 Dakikada Kurulum

### 📋 **Gereksinimler Kontrolü**
```bash
# Node.js var mı?
node --version  # v18+ olmalı

# Git var mı?  
git --version

# Yoksa: https://nodejs.org ve https://git-scm.com
```

### 📦 **Hızlı İndirme**
```bash
# GitHub'dan indir
git clone https://github.com/laylaymen/kriptobot.git
cd kriptobot

# Bağımlılıkları yükle (1 dakika)
npm install
```

---

## ⚙️ 2 Dakikada Ayarlama

### 🔐 **API Anahtarları** (Zorunlu)
```bash
# ENV kurulum wizard'ı
node "kirpto bot sinyal/setup-env.js"

# Gerekli anahtarlar:
# ✅ BINANCE_API_KEY
# ✅ BINANCE_SECRET_KEY  
# ✅ TELEGRAM_BOT_TOKEN
# ✅ TELEGRAM_CHAT_ID
```

### 🎯 **Hızlı Ayar Menüsü**
```
[1] 🔑 API Anahtarları → Binance + Telegram
[2] 🎚️ Risk Ayarları → %1-5 risk seviyesi  
[3] 📊 Coin Listesi → BTCUSDT, ETHUSDT, BNBUSDT
[4] ⏰ Zaman Çerçevesi → 1m, 5m, 15m, 1h
```

---

## 🧪 3 Dakikada İlk Test

### ✅ **Sistem Kontrolü**
```bash
# Hızlı test (30 saniye)
node "kirpto bot sinyal/quick-test.js"

# Sonuç örneği:
# ✅ Binance bağlantısı: OK
# ✅ Telegram botu: OK  
# ✅ Modüller: 204/204 loaded
# ✅ Sistem hazır!
```

### 🔍 **Detaylı Test**  
```bash
# Veri akışı testi
node tests/debug-livia.js

# Modül testi
node "kirpto bot sinyal/modules/dataFetcher.test.js"
```

---

## 🎮 4 Dakikada İlk Çalıştırma

### 🚀 **Ana Sistemi Başlat**
```bash
# KRIPTOBOT'u başlat
node "kirpto bot sinyal/index.js"

# Çıktı örneği:
# 🤖 KRIPTOBOT başlatılıyor...
# 🧠 Grafik Beyni: ✅ 69 modül yüklendi
# 🎯 VIVO Sinyal: ✅ 42 modül aktif
# 🔮 LIVIA AI: ✅ 84 modül hazır
# 🧘 Otobilinç: ✅ Psikoloji aktif
# 🔍 Denetim: ✅ İzleme başladı
# 📱 Telegram: İlk rapor gönderildi
```

### 📊 **Gerçek Zamanlı İzleme**
- **Terminal:** Anlık loglar
- **Telegram:** Önemli sinyaller  
- **Dosya:** `logs/` klasöründe detaylar

---

## 💡 5 Dakikada İlk Sinyal

### 🎯 **Sinyal Türleri**
```
📈 LONG Sinyali - Yükseliş beklentisi
📉 SHORT Sinyali - Düşüş beklentisi  
⏹️ STOP Sinyali - Pozisyon kapatma
🔄 ENTRY Sinyali - Giriş noktası
```

### 📱 **Telegram Bildirimi Örneği**
```
🤖 KRIPTOBOT SINYAL

📊 Coin: BTCUSDT
📈 Tip: LONG
💰 Fiyat: $67,250
🎯 Hedef: $68,500 (+1.86%)
⛔ Stop: $66,000 (-1.86%)
💎 Güven: %87

🧠 Grafik: Cup&Handle formasyonu
🎯 VIVO: Hacim konfirmasyonu
🔮 LIVIA: Yüksek olasılık sinyali
```

---

## 🛠️ Sorun Giderme - 1 Dakika

### ❌ **Sık Karşılaşılan Hatalar**

#### 🔑 **API Key Hatası**
```bash
Error: Invalid API key

# Çözüm:
node "kirpto bot sinyal/encrypt-api-keys.js"
# Anahtarları yeniden gir
```

#### 📡 **Bağlantı Hatası**  
```bash
Error: Network timeout

# Çözüm:
# 1. İnternet bağlantısını kontrol et
# 2. Binance erişimini test et
# 3. VPN varsa kapat/aç
```

#### 🔧 **Modül Hatası**
```bash
Error: Module not found

# Çözüm:
npm install --force
# Bağımlılıkları yeniden yükle
```

---

## 📚 Daha Fazlası - Detaylı Rehber

### 📖 **Gelişmiş Ayarlar**
- [`docs/MODÜL-REHBERİ.md`](docs/MODÜL-REHBERİ.md) - Modül detayları
- [`docs/guides/QUICK_REFERENCE.md`](docs/guides/QUICK_REFERENCE.md) - Komut referansı

### 🎯 **Strateji Geliştirme**  
- [`kirpto bot sinyal/strategies/`](kirpto%20bot%20sinyal/strategies/) - Mevcut stratejiler
- [`examples/`](examples/) - Örnek kodlar

### 🔧 **İleri Seviye**
- [`docs/SYSTEM_SUMMARY.md`](docs/SYSTEM_SUMMARY.md) - Sistem mimarisi
- [`docs/SISTEM_GELISTIRME_PLANI.md`](docs/SISTEM_GELISTIRME_PLANI.md) - Geliştirme planı

---

## 🏁 Özet - 5 Dakikada Hazır!

```bash
# ⚡ Tüm işlemler tek komutla:
git clone https://github.com/laylaymen/kriptobot.git && \
cd kriptobot && \
npm install && \
node "kirpto bot sinyal/setup-env.js" && \
node "kirpto bot sinyal/quick-test.js" && \
node "kirpto bot sinyal/index.js"
```

### ✅ **Başarı Kriterleri**
- [ ] Sistem testleri geçti
- [ ] Telegram bildirimi geldi  
- [ ] İlk sinyal oluştu
- [ ] Loglar akıyor

**🎉 Tebrikler! KRIPTOBOT'unuz artık aktif! 🚀**

---

*Herhangi bir sorun yaşarsanız: [GitHub Issues](https://github.com/laylaymen/kriptobot/issues)*