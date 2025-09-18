# Kriptobot Modüler Sistem Organizasyonu

## 🎯 Genel Bakış
Kriptobot'un 5 ana sistemi artık modüler bir yapıda organize edilmiştir. Her sistem kendi klasöründe, ilgili modüllerle birlikte bulunmaktadır.

## 📊 Grafik Beyni Sistemi (81 modül)
**Klasör:** `/kirpto bot sinyal/modules/grafikBeyni/`

### Ana Kategoriler:
- **Pattern Recognition:** Triangle detectors, H&S, cup&handle, flag patterns
- **Technical Analysis:** RSI, EMA, MACD, Bollinger Bands, trend analysis
- **Support/Resistance:** Level mapping, breakout validation, zone detection
- **Volume Analysis:** Volume pressure, shock detection, confirmation
- **Risk Assessment:** Volatility estimation, anomaly detection
- **Market Structure:** Trend classification, momentum validation

### Öne Çıkan Modüller:
- `technicalIndicatorsEngine.js` - Ana teknik analiz motoru
- `supportResistanceMapper.js` - S/R seviye haritalama
- `comboBreakDetector.js` - Kombinasyon breakout tespiti
- `falseBreakFilter.js` - Yalancı kırılım filtresi
- `volatilityAssessment.js` - Volatilite değerlendirmesi

---

## 🔄 VIVO Sistemi (41 modül)
**Klasör:** `/kirpto bot sinyal/modules/vivo/`

### Ana Kategoriler:
- **Signal Processing:** Decision routing, quality assurance, correlation
- **Execution:** Intent throttling, quality monitoring, fill emulation
- **Risk Management:** Budget allocation, tolerance selection, exposure balancing
- **Position Management:** Multi-position optimization, size optimization
- **Strategy Management:** Allocation, bandit orchestration, stability scoring
- **Performance Monitoring:** Telemetry, quality gates, feedback loops

### Öne Çıkan Modüller:
- `signalDecisionRouter.ts` - Ana sinyal karar verici
- `riskBudgetAllocator.ts` - Risk bütçe yönetimi
- `strategyAllocator.ts` - Strateji tahsis sistemi
- `executionQualityMonitor.ts` - Execution kalite monitörü
- `portfolioExposureBalancer.ts` - Portföy exposure dengesi

---

## 🧠 Otobilinç Sistemi (5 modül)
**Klasör:** `/kirpto bot sinyal/modules/otobilinc/`

### Modüller:
- `psychCheckGate.js` - Psikolojik durum kapısı
- `frustrationDrivenOvertrader.js` - Frustrasyon kaynaklı overtrading tespiti
- `marketBiasInterpreter.js` - Piyasa bias yorumlayıcısı
- `marketEmotionInterpreter.js` - Piyasa duygu yorumlayıcısı
- `teyitZinciriBiasGuard.js` - Teyit zinciri bias koruması

---

## 💭 LIVIA Sistemi (4 modül)
**Klasör:** `/kirpto bot sinyal/modules/livia/`

### Modüller:
- `newsSentimentAnalyzer.js` - Haber duygu analizi
- `newsReactionRouter.js` - Haber tepki yönlendiricisi
- `biasWeightedSignalTuner.ts` - Bias ağırlıklı sinyal ayarlayıcısı
- `postureMemory.ts` - Piyasa duruş hafızası

---

## 🔍 Denetim Asistanı Sistemi (4 modül)
**Klasör:** `/kirpto bot sinyal/modules/denetimAsistani/`

### Modüller:
- `riskBreachIncidentReporter.ts` - Risk ihlali olay raporu
- `exchangeConnectivitySentry.ts` - Borsa bağlantı nöbetçisi
- `postmortemAutoDraft.ts` - Otomatik postmortem taslağı
- `metricsRollupDownsampler.ts` - Metrik toplama ve örnekleme

---

## 📁 Ortak/Shared Modüller (52 modül)
**Klasör:** `/kirpto bot sinyal/modules/` (ana dizin)

### Ana Kategoriler:
- **Data Infrastructure:** UMF, data fetcher, raw storage
- **Communication:** Telegram, message manager, news fetcher
- **Core Utilities:** Encryption, environment, scheduling
- **Testing:** Test files, pipeline tests
- **Integration:** Adapters, coordinators, orchestrators

---

## 🔄 Veri Akışı
1. **Veri Girişi:** Shared modüller (UMF, data fetcher)
2. **Analiz:** Grafik Beyni (teknik analiz)
3. **Psikolojik Kontrol:** Otobilinç (bias detection)
4. **Sinyal İşleme:** VIVO (execution, routing)
5. **Duygusal Filtreleme:** LIVIA (sentiment filtering)
6. **İzleme:** Denetim Asistanı (monitoring, reporting)

## 🚀 Gelecek Sistemler
Bu organizasyon yapısı yeni sistemlerin eklenmesine hazırdır:
- `/modules/yeniSistem/` klasörü oluşturulabilir
- Modüller kategorize edilebilir
- Veri akışı entegrasyonu kolay yapılabilir

## 📋 Kullanım
```bash
# Sistem modüllerini yüklemek için:
const grafikBeyni = require('./modules/grafikBeyni/technicalIndicatorsEngine.js');
const vivo = require('./modules/vivo/signalDecisionRouter.ts');
const otobilinc = require('./modules/otobilinc/psychCheckGate.js');
const livia = require('./modules/livia/newsSentimentAnalyzer.js');
const denetim = require('./modules/denetimAsistani/riskBreachIncidentReporter.ts');
```

---
**Son Güncelleme:** $(date)  
**Toplam Modül Sayısı:** 187  
**Organizasyon Durumu:** ✅ Tamamlandı