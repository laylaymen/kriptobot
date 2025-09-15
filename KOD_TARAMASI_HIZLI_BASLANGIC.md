# 🚀 Kod Taraması Hızlı Başlangıç

## ⚡ Hızlı Komutlar

```bash
# 🔍 Hızlı kod taraması
pnpm run security:scan

# 🔧 Sorunları otomatik düzelt
pnpm run security:fix

# 📊 Sadece lint kontrolü
pnpm run lint:check

# 🔒 Sadece güvenlik kontrolü
pnpm audit --audit-level moderate
```

## 🎯 GitHub'dan Kod Taraması Açma

### 1. Repository Ayarları
1. GitHub'da repo sayfasına git
2. **Settings** → **Code security and analysis**
3. Şunları etkinleştir:
   - ✅ **Code scanning alerts**
   - ✅ **Dependabot alerts**
   - ✅ **Secret scanning alerts**

### 2. Manuel Tarama Çalıştırma
1. **Actions** sekmesine git
2. **🔍 Manual Code Scanning** workflow'unu seç
3. **Run workflow** buton → **Run workflow**

### 3. Sonuçları Görme
- **Security** sekmesi → **Code scanning** ve **Dependabot**
- **Actions** → Son çalışan workflow logları

## 🔧 Yerel Geliştirme

```bash
# Tüm sorunları görmek için
pnpm run lint:check 2>&1 | tee lint-report.txt

# Otomatik düzeltmeler
pnpm run lint:fix

# Güvenlik uyarıları
pnpm audit --fix
```

## 📋 Tarama Türleri

| Tür | Komut | Açıklama |
|-----|-------|----------|
| 🔍 **CodeQL** | GitHub Actions | Gelişmiş kod analizi |
| 🔒 **Security** | `pnpm audit` | Bağımlılık güvenliği |
| 🎯 **Quality** | `pnpm run lint` | Kod kalitesi |
| 🔐 **Secrets** | GitHub Actions | API key/şifre kontrolü |

## ⚠️ Yaygın Sorunlar ve Çözümler

### Workflow Çalışmıyor
```bash
# Permissions kontrol et
# .github/workflows/security.yml dosyasında:
permissions:
  contents: read
  security-events: write
```

### ESLint Hataları
```bash
# Belirli kurallari ignore et
# .eslintrc.js'de:
rules: {
  'no-console': 'off',  // Console log'lara izin ver
}
```

### Bağımlılık Sorunları
```bash
# Güncellemeleri kontrol et
pnpm outdated

# Güvenlik güncellemeleri yap
pnpm update
pnpm audit fix
```

## 🎯 İlk Adımlar

1. **Repository ayarlarını kontrol et** (yukarıdaki adımlar)
2. **İlk manual scan çalıştır**: Actions → Manual Code Scanning
3. **Sonuçları incele**: Security sekmesi
4. **Yerel geliştirmede kullan**: `pnpm run security:scan`

## 📞 Yardım

- 📖 Detaylı döküman: [KOD_TARAMASI_REHBERI.md](KOD_TARAMASI_REHBERI.md)
- 🔗 GitHub Issues: Repository'de yeni issue aç
- 📊 Workflow logları: Actions sekmesinden kontrol et

---
**Son güncellenme**: 2024
**Durum**: ✅ Kod taraması aktif ve hazır