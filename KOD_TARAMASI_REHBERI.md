# 🔍 Kod Taraması (Code Scanning) Rehberi

Bu döküman, Kriptobot projesinde kod taramasını nasıl etkinleştireceğinizi ve kullanacağınızı açıklamaktadır.

## 📋 İçindekiler

1. [Kod Taraması Nedir?](#kod-taraması-nedir)
2. [Mevcut Kurulum](#mevcut-kurulum)
3. [Kod Taramasını Etkinleştirme](#kod-taramasını-etkinleştirme)
4. [Sonuçları Görüntüleme](#sonuçları-görüntüleme)
5. [Yerel Kod Taraması](#yerel-kod-taraması)
6. [Yapılandırma](#yapılandırma)
7. [Sorun Giderme](#sorun-giderme)

## 🔍 Kod Taraması Nedir?

Kod taraması, kodunuzdaki güvenlik açıklarını, hataları ve kod kalitesi sorunlarını otomatik olarak tespit eden bir süreçtir. Bu proje şu araçları kullanır:

- **GitHub CodeQL**: Gelişmiş kod analizi ve güvenlik taraması
- **Snyk**: Bağımlılık güvenlik taraması
- **ESLint**: Kod kalitesi ve stil kontrolü
- **Custom Security Checks**: Özel güvenlik kontrolleri

## 🔧 Mevcut Kurulum

Projede kod taraması zaten yapılandırılmıştır:

### Otomatik Taramalar
- ✅ **Push olayında**: `main` ve `develop` branch'lerine push yapıldığında
- ✅ **Pull Request**: `main` branch'ine açılan PR'lerde
- ✅ **Zamanlanmış**: Her gün sabah 02:00'da (UTC)

### Tarama Türleri
- 🔒 **CodeQL Analizi**: JavaScript/Node.js güvenlik ve kalite taraması
- 🔐 **Bağımlılık Taraması**: npm paketlerinde güvenlik açığı kontrolü
- 🔑 **Secret Scanning**: API anahtarları ve şifreler için tarama
- 📊 **Code Quality**: ESLint ile kod kalitesi kontrolü

## 🚀 Kod Taramasını Etkinleştirme

### 1. GitHub Repository Ayarları

GitHub repository'nizde kod taramasını etkinleştirmek için:

```bash
# Repository ana sayfasında:
1. "Settings" sekmesine gidin
2. Sol menüden "Code security and analysis" seçin
3. Şu özellikleri etkinleştirin:
   - ✅ Dependency graph
   - ✅ Dependabot alerts
   - ✅ Dependabot security updates
   - ✅ Code scanning alerts
   - ✅ Secret scanning alerts
```

### 2. Workflow'u Manuel Tetikleme

```bash
# GitHub Actions sayfasından:
1. Repository'de "Actions" sekmesine gidin
2. "🔒 Security Analysis" workflow'unu seçin
3. "Run workflow" butonuna tıklayın
4. Branch'i seçin ve "Run workflow"a tıklayın
```

### 3. Local Development ile Tetikleme

```bash
# Kod değişikliği yaparak:
git add .
git commit -m "feat: trigger security scan"
git push origin main
```

## 📊 Sonuçları Görüntüleme

### GitHub Web Interface

1. **Security Tab**: Repository ana sayfasında "Security" sekmesi
2. **Code Scanning Alerts**: Tespit edilen güvenlik sorunları
3. **Dependency Alerts**: Bağımlılık güvenlik uyarıları
4. **Secret Scanning**: Tespit edilen sırlar

### Actions Logs

```bash
# GitHub Actions loglarını görüntüleme:
1. "Actions" sekmesine gidin
2. Son çalışan "🔒 Security Analysis" workflow'una tıklayın
3. Her step'in detaylı loglarını görüntüleyin
```

### Artifacts

Tarama sonuçları artifact olarak saklanır:
- `security-report-{sha}`: Güvenlik raporu
- `coverage-reports`: Test coverage raporları

## 💻 Yerel Kod Taraması

### ESLint ile Kod Kalitesi

```bash
# Linting kontrolü
pnpm run lint:check

# Linting düzeltme
pnpm run lint:fix
```

### Security Audit

```bash
# Bağımlılık güvenlik taraması
pnpm audit --audit-level moderate

# Düzeltmeler
pnpm audit fix
```

### Manuel Secret Scanning

```bash
# API key kontrolü
grep -r "api[_-]?key" . --exclude-dir=node_modules --exclude-dir=.git

# Password kontrolü
grep -r "password" . --exclude-dir=node_modules --exclude-dir=.git
```

### CodeQL Local Analysis

```bash
# CodeQL CLI kurulumu
npm install -g @github/codeql-cli

# Veritabanı oluşturma
codeql database create kriptobot-db --language=javascript

# Analiz çalıştırma
codeql database analyze kriptobot-db --format=csv --output=results.csv
```

## ⚙️ Yapılandırma

### CodeQL Yapılandırması

CodeQL ayarları `.github/codeql/codeql-config.yml` dosyasında:

```yaml
# Özel query'ler ekleme
queries:
  - uses: security-and-quality
  - uses: security-extended

# Taranacak yollar
paths:
  - kirpto bot sinyal/
  - packages/
  - sentiment-analysis-module/

# Hariç tutulacak yollar
paths-ignore:
  - node_modules/
  - "**/*.test.js"
  - coverage/
```

### Workflow Yapılandırması

`.github/workflows/security.yml` dosyasında:

```yaml
# Tarama zamanlaması
schedule:
  - cron: '0 2 * * *'  # Her gün 02:00

# Branch'ler
on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
```

### ESLint Yapılandırması

Proje root'unda `.eslintrc.js` oluşturun:

```javascript
module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    'no-console': 'warn',
    'no-unused-vars': 'error',
    'no-undef': 'error',
  },
};
```

## 🔧 Sorun Giderme

### Yaygın Sorunlar

#### 1. CodeQL Başlatılamıyor
```bash
# Çözüm: Node.js versiyonu kontrolü
node --version  # 18+ olmalı
```

#### 2. Workflow Çalışmıyor
```bash
# Çözüm: Permissions kontrolü
# .github/workflows/security.yml'de:
permissions:
  contents: read
  security-events: write
  actions: read
```

#### 3. False Positive Alerts
```yaml
# .github/codeql/codeql-config.yml'de:
query-filters:
  - exclude:
      id: js/unused-local-variable
```

#### 4. Dependency Alerts
```bash
# Güvenlik güncellemeleri
pnpm update
pnpm audit fix

# Manuel kontrol
pnpm audit --audit-level high
```

### Debug Komutları

```bash
# Workflow durumu kontrolü
gh workflow list

# Son çalışan workflow logları
gh run list --workflow="security.yml" --limit=1
gh run view --log

# Secrets kontrolü (repo admin gerekli)
gh secret list
```

### Performance Optimizasyonu

```yaml
# Workflow timeout ayarları
jobs:
  security-scan:
    timeout-minutes: 20  # Varsayılan: 360

# Cache kullanımı
- name: Cache dependencies
  uses: actions/cache@v3
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('pnpm-lock.yaml') }}
```

## 📈 Monitoring ve Raporlama

### Weekly Security Report

```bash
# Weekly rapor için GitHub CLI
gh api repos/:owner/:repo/code-scanning/alerts \
  --jq '.[] | select(.created_at > "2024-01-01")'
```

### Metrics

- **MTTD**: Mean Time To Detection
- **MTTR**: Mean Time To Resolution
- **Coverage**: Code coverage percentage
- **Vulnerability Density**: Issues per KLOC

## 🔗 Kaynaklar

- [GitHub CodeQL Documentation](https://docs.github.com/en/code-security/code-scanning)
- [Snyk Documentation](https://docs.snyk.io/)
- [ESLint Configuration](https://eslint.org/docs/user-guide/configuring)
- [GitHub Security Features](https://docs.github.com/en/code-security)

## 📞 Destek

Sorunlar için:
1. Bu repository'de issue açın
2. Workflow loglarını kontrol edin
3. GitHub Security Advisory'leri takip edin

---

**Son Güncelleme**: $(date)
**Versiyon**: 1.0.0