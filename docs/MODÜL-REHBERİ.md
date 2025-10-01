# 🧠 KRIPTOBOT Modül Rehberi

## 🎯 Ana Sistemler

### 1. 🧠 **Grafik Beyni** - Teknik Analiz Merkezi
**Konum:** `kirpto bot sinyal/modules/grafikBeyni/`
**Toplam Modül:** 69 adet

#### 🔥 Öne Çıkan Modüller:
- `trendDetector.js` - Trend yönü analizi
- `supportResistanceScanner.js` - Destek/direnç seviyeleri  
- `breakoutValidator.js` - Kırılım doğrulaması
- `volumeShiftAnalyzer.js` - Hacim analizi
- `candlestickInterpreter.js` - Mum formasyonu

#### 📊 İşlevler:
- Pattern recognition (Başbayrak, fincan kulp, üçgen)
- Trend analizi ve doğrulama
- Hacim ve momentum hesaplama
- Risk/ödül oranı optimizasyonu

---

### 2. 🎯 **VIVO** - Sinyal Koordinatörü  
**Konum:** `kirpto bot sinyal/modules/vivo/`
**Toplam Modül:** 42 adet

#### 🚀 Ana Fonksiyonlar:
- `signalDecisionRouter.js` - Sinyal yönlendirme
- `positionSizeOptimizer.js` - Pozisyon boyutu
- `riskBudgetAllocator.js` - Risk dağılımı
- `executionQualityMonitor.js` - Emir kalitesi
- `marketPostureDetector.js` - Market duruş analizi

---

### 3. 🔮 **LIVIA** - Yapay Zeka Asistanı
**Konum:** `modules/livia/`
**Toplam Modül:** 84 adet

#### 🧠 Zeka Modülleri:
- `strategicAIAdvisor.js` - Strateji danışmanı
- `emotionalAICoach.js` - Duygusal koçluk
- `predictiveAIEngine.js` - Tahmin motoru  
- `neuralPatternMatcher.js` - Pattern matching
- `biasAwarenessMonitor.js` - Önyargı kontrolü

#### 🔐 Güvenlik & Kontrol:
- `ethicsAndComplianceGate.js` - Etik kontrol
- `actionApprovalGateway.js` - İşlem onayı
- `reactiveDefenseGate.js` - Reaktif savunma
- `confirmationBounds.js` - Onay sınırları

---

### 4. 🧘 **Otobilinç** - Psikoloji Motoru
**Konum:** `kirpto bot sinyal/modules/otobilinc/`  
**Toplam Modül:** 5 adet

#### 🎭 Psikolojik Analiz:
- `marketEmotionInterpreter.js` - Market duyguları
- `frustrationDrivenOvertrader.js` - Aşırı trading kontrolü
- `marketBiasInterpreter.js` - Market önyargıları
- `teyitZinciriBiasGuard.js` - Doğrulama önyargısı
- `psychCheckGate.js` - Psikolojik kontrol kapısı

---

### 5. 🔍 **Denetim Asistanı** - İzleme & Kontrol
**Konum:** `kirpto bot sinyal/modules/denetimAsistani/`
**Toplam Modül:** 4 adet

#### 📊 İzleme Sistemleri:
- `metricsRollupDownsampler.js` - Metrik toplama
- `postmortemAutoDraft.js` - Olay sonrası analiz
- `riskBreachIncidentReporter.js` - Risk ihlali raporu

---

## 🔧 Yardımcı Sistemler

### 📡 **Veri Akışı**
- `unifiedMarketFeed.js` - Birleşik market verisi
- `dataFetcher.js` - Veri toplama
- `newsFetcher.js` - Haber analizi
- `rateLimitOrchestrator.js` - Rate limit yönetimi

### 💬 **İletişim**
- `sendTelegram.js` - Telegram bildirimleri  
- `messageManager.js` - Mesaj yönetimi
- `eventNormalizer.js` - Olay normalizasyonu

### 🔐 **Güvenlik**
- `envManager.js` - Çevre değişkenleri
- `envSecure.js` - Şifreleme
- `orderbookValidator.js` - Orderbook doğrulama

---

## 🎮 Hızlı Kullanım

### 💡 Yeni Modül Eklemek:
1. İlgili klasöre git (`grafikBeyni/`, `vivo/`, vs.)
2. Template'i kopyala: `cp grafikBeyniModuleBase.js yeniModul.js`
3. Sınıf adını ve işlevini değiştir
4. Ana orchestrator'a ekle

### 🔍 Modül Bulmak:
1. İşlev türüne göre klasör seç
2. Dosya adından işlevi anla
3. `README.md` ana sayfasından navigasyon

### 🧪 Test Etmek:
```bash
# Tekil modül testi
node modules/grafikBeyni/trendDetector.js

# Sistem testi  
node tests/debug-livia.js

# Entegrasyon testi
node kirpto\ bot\ sinyal/quick-test.js
```

---

## 📈 Modül İstatistikleri

| 🏗️ **Sistem** | 📊 **Modül Sayısı** | 🎯 **Ana İşlev** |
|----------------|----------------------|-------------------|
| Grafik Beyni | 69 | Teknik analiz |
| LIVIA | 84 | AI koordinasyon |  
| VIVO | 42 | Sinyal yönetimi |
| Otobilinç | 5 | Psikoloji |
| Denetim | 4 | İzleme |
| **TOPLAM** | **204** | **Tam otomasyon** |

---

*Bu dokümantasyon sürekli güncellenmektedir. Son güncelleme: October 1, 2025*