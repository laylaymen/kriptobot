# 🚀 KRIPTOBOT Codespace Yönetim Kılavuzu

## 🔐 Codespace Silinme Koruması

### ✅ Otomatik Koruma (Aktif)
- **Retention Period:** 43200 dakika (30 gün)
- **Auto-Renewal:** Her kullanımda süre sıfırlanır
- **Son Aktivite:** Otomatik izleniyor

### 🛡️ Manuel Koruma Yöntemleri

#### 1. **Keep-Alive Script (Önerilir)**
```bash
# Günlük çalıştır
./keep-alive.sh
```

#### 2. **Düzenli Aktivite**
- Her 7-10 günde bir Codespace'i aç
- Herhangi bir dosyayı düzenle
- Terminal'de basit komut çalıştır

#### 3. **Acil Durum Backup**
```bash
# Hızlı backup oluştur
zip -r emergency-backup.zip . -x "node_modules/*" ".git/*"
```

### 📱 Mobil Koruma
1. **GitHub Mobile** uygulamasından
2. Codespace'i aç
3. Herhangi bir dosyaya dokunarak aktivite oluştur

### ⚠️ Önemli Notlar
- **Maksimum retention:** 30 gün (değiştirilemez)
- **Her kullanım:** Süreyi 30 güne sıfırlar
- **Otomatik backup:** Git push ile güncel tutuluyor

### 🆘 Acil Durum Planı
1. Codespace silinirse: `gh codespace create -r laylaymen/kriptobot`
2. Backup'tan restore: Git clone + ZIP restore
3. ENV kurulumu: `node setup-env.js`

---
**Son Güncelleme:** $(date)
**Durum:** ✅ GÜVENLİ