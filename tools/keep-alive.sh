#!/bin/bash
# Codespace Keep-Alive Script
# Bu script codespace'i aktif tutar

echo "🔄 Codespace Keep-Alive başlatılıyor..."
echo "📅 Tarih: $(date)"

# GitHub CLI ile codespace'i yenile
gh codespace list > /dev/null 2>&1

# Basit bir dosya işlemi (timestamp güncelle)
echo "$(date)" > /workspaces/kriptobot/.last-activity

# Git durumunu kontrol et
git status > /dev/null 2>&1

echo "✅ Keep-alive tamamlandı"
echo "⏰ Sonraki çalışma: $(date -d '+1 day')"