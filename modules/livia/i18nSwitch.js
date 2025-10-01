/**
 * LIVIA-12 · i18nSwitch.js
 * Akıllı çok dilli sistem - TR⇄EN dil tespiti, çeviri ve biçimleme
 */

const { z } = require('zod');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError } = require('../../kirpto bot sinyal/logs/logger');

// 🎯 Smart Schemas - Sadece gerekli olanlar
const I18nEventSchema = z.object({
    event: z.string(),
    text: z.string(),
    locale: z.enum(['tr', 'en', 'auto']).default('auto'),
    auth: z.object({
        userId: z.string(),
        roles: z.array(z.string())
    })
});

const I18nPreferenceSchema = z.object({
    event: z.literal('i18n.preference.set'),
    userId: z.string(),
    locale: z.enum(['tr', 'en'])
});

/**
 * 🚀 Smart Language Detector
 */
class SmartLanguageDetector {
    constructor(config) {
        this.config = config;
        // Temel TR/EN anahtar kelimeler
        this.trWords = ['ve', 'bir', 'bu', 'ile', 'için', 'olan', 'var', 'çok', 'daha', 'kadar'];
        this.enWords = ['the', 'and', 'with', 'for', 'from', 'this', 'that', 'have', 'will', 'are'];
        this.techTerms = ['halt_entry', 'failover', 'slippage', 'spread', 'bps', 'TWAP', 'LIMIT', 'MARKET'];
    }

    detect(text) {
        if (text.length < this.config.minChars) {
            return { detected: 'tr', confidence: 0.5, reason: 'too_short' };
        }

        const words = text.toLowerCase().split(/\s+/);
        let trScore = 0;
        let enScore = 0;

        // Kelime skorlama
        words.forEach(word => {
            if (this.trWords.includes(word)) trScore += 2;
            if (this.enWords.includes(word)) enScore += 2;
            if (this.techTerms.some(term => term.toLowerCase() === word)) {
                enScore += 1; // Teknik terimler EN'e eğilim
            }
        });

        // Türkçe karakter kontrolü
        const trChars = /[çğıöşüÇĞIİÖŞÜ]/g;
        const trCharCount = (text.match(trChars) || []).length;
        if (trCharCount > 0) trScore += trCharCount;

        const total = trScore + enScore;
        if (total === 0) {
            return { detected: 'tr', confidence: 0.5, reason: 'default' };
        }

        const confidence = Math.max(trScore, enScore) / total;
        const detected = trScore > enScore ? 'tr' : 'en';

        return {
            detected,
            confidence: Number(confidence.toFixed(2)),
            reason: 'word_analysis'
        };
    }
}

/**
 * 🌐 Smart Translator
 */
class SmartTranslator {
    constructor(config) {
        this.config = config;
        this.glossary = new Set(config.glossary.protected);
        
        // Basit çeviri sözlüğü (gerçek uygulamada API olur)
        this.dictionary = {
            'tr-en': {
                've': 'and',
                'ile': 'with',
                'için': 'for',
                'onay': 'approval',
                'red': 'rejection',
                'limit': 'limit',
                'miktar': 'quantity',
                'fiyat': 'price'
            },
            'en-tr': {
                'and': 've',
                'with': 'ile',
                'for': 'için',
                'approval': 'onay',
                'rejection': 'red',
                'limit': 'limit',
                'quantity': 'miktar',
                'price': 'fiyat'
            }
        };
    }

    translate(text, fromLang, toLang) {
        if (fromLang === toLang) {
            return { text, kept: [], violations: [] };
        }

        const dictKey = `${fromLang}-${toLang}`;
        const dict = this.dictionary[dictKey] || {};
        
        let result = text;
        const kept = [];
        const violations = [];

        // Glossary koruması
        this.glossary.forEach(term => {
            if (text.includes(term)) {
                kept.push(term);
            }
        });

        // Basit kelime çevirisi (gerçek uygulamada AI/API)
        const words = text.split(/\s+/);
        const translatedWords = words.map(word => {
            const cleanWord = word.toLowerCase().replace(/[.,!?]/g, '');
            
            // Glossary koruması
            if (this.glossary.has(cleanWord) || this.glossary.has(word)) {
                return word; // Aynen koru
            }
            
            // Sözlükten çevir
            const translated = dict[cleanWord];
            if (translated) {
                return word.replace(cleanWord, translated);
            }
            
            return word; // Değiştirmeden koru
        });

        result = translatedWords.join(' ');
        
        return { text: result, kept, violations };
    }
}

/**
 * 🎨 Smart Formatter
 */
class SmartFormatter {
    constructor(config) {
        this.config = config;
    }

    format(text, locale) {
        let result = text;
        
        // Sayı formatları
        if (locale === 'tr') {
            // EN 1,234.56 → TR 1.234,56
            result = result.replace(/(\d{1,3}(?:,\d{3})*)\\.(\d{2})/g, (match, intPart, decPart) => {
                return intPart.replace(/,/g, '.') + ',' + decPart;
            });
        } else {
            // TR 1.234,56 → EN 1,234.56
            result = result.replace(/(\d{1,3}(?:\.\d{3})*),(\d{2})/g, (match, intPart, decPart) => {
                return intPart.replace(/\./g, ',') + '.' + decPart;
            });
        }

        // Para birimi
        if (locale === 'tr') {
            result = result.replace(/\$(\d+)/g, '$1 TRY');
        } else {
            result = result.replace(/(\d+)\s*TRY/g, '$$$1');
        }

        return result;
    }
}

/**
 * 🎯 LIVIA-12 Smart I18n Switch
 */
class I18nSwitch {
    constructor(config = {}) {
        this.name = 'I18nSwitch';
        this.config = {
            defaultLocale: 'tr',
            supported: ['tr', 'en'],
            minChars: 6,
            threshold: 0.75,
            glossary: {
                protected: ['halt_entry', 'failover', 'slippage', 'spread', 'bps', 'TWAP', 'LIMIT', 'MARKET']
            },
            cache: { ttlMs: 900000, maxEntries: 2000 },
            ...config
        };
        
        this.userPreferences = new Map(); // userId -> locale
        this.cache = new Map(); // cacheKey -> result
        this.detector = new SmartLanguageDetector(this.config);
        this.translator = new SmartTranslator(this.config);
        this.formatter = new SmartFormatter(this.config);
        this.stats = { detections: 0, translations: 0, cacheHits: 0 };
        
        this.isInitialized = false;
        this.logger = null;
    }

    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            this.setupEventListeners();
            this.startPeriodicTasks();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Dil tercihi ayarla
        eventBus.subscribeToEvent('i18n.preference.set', (event) => {
            this.handlePreferenceSet(event.data);
        }, 'i18nSwitch');
        
        // Metin işleme istekleri
        eventBus.subscribeToEvent('i18n.process', (event) => {
            this.handleProcess(event.data);
        }, 'i18nSwitch');
        
        // Operatör yanıtları
        eventBus.subscribeToEvent('operator.response.in', (event) => {
            this.handleOperatorText(event.data);
        }, 'i18nSwitch');
        
        // Şablon render istekleri
        eventBus.subscribeToEvent('template.render.request', (event) => {
            this.handleTemplateRender(event.data);
        }, 'i18nSwitch');
    }

    async handlePreferenceSet(data) {
        try {
            const preference = I18nPreferenceSchema.parse(data);
            this.userPreferences.set(preference.userId, preference.locale);
            
            this.emit('i18n.preference.updated', {
                userId: preference.userId,
                locale: preference.locale
            });
            
        } catch (error) {
            this.logger.error('Preference set error:', error);
        }
    }

    async handleProcess(data) {
        try {
            const event = I18nEventSchema.parse(data);
            const result = await this.processText(event.text, event.locale, event.auth.userId);
            
            this.emit('i18n.result', {
                original: event.text,
                result,
                userId: event.auth.userId
            });
            
        } catch (error) {
            this.logger.error('Process error:', error);
            this.emit('i18n.error', { error: error.message });
        }
    }

    async handleOperatorText(data) {
        try {
            if (data.payload && data.payload.note) {
                const result = await this.processText(data.payload.note, 'auto', data.auth.userId);
                
                this.emit('i18n.operator.processed', {
                    promptId: data.promptId,
                    original: data.payload.note,
                    result,
                    userId: data.auth.userId
                });
            }
        } catch (error) {
            this.logger.error('Operator text error:', error);
        }
    }

    async handleTemplateRender(data) {
        try {
            const userLocale = this.resolveUserLocale(data.locale, data.auth?.userId);
            
            this.emit('i18n.template.locale.resolved', {
                requestedLocale: data.locale,
                resolvedLocale: userLocale,
                templateId: data.id,
                userId: data.auth?.userId
            });
            
        } catch (error) {
            this.logger.error('Template render error:', error);
        }
    }

    // 🎯 Core processing - akıllı ve hızlı
    async processText(text, requestedLocale, userId) {
        // Cache kontrolü
        const cacheKey = this.getCacheKey(text, requestedLocale, userId);
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.config.cache.ttlMs) {
            this.stats.cacheHits++;
            return cached.result;
        }

        // Dil tespiti
        const detection = this.detector.detect(text);
        this.stats.detections++;
        
        // Hedef dil belirleme
        const targetLocale = this.resolveTargetLocale(requestedLocale, userId, detection.detected);
        
        // Çeviri gerekli mi?
        let translatedText = text;
        let translationInfo = { kept: [], violations: [] };
        
        if (detection.detected !== targetLocale) {
            const translation = this.translator.translate(text, detection.detected, targetLocale);
            translatedText = translation.text;
            translationInfo = { kept: translation.kept, violations: translation.violations };
            this.stats.translations++;
        }
        
        // Biçimleme
        const formattedText = this.formatter.format(translatedText, targetLocale);
        
        const result = {
            detected: detection.detected,
            confidence: detection.confidence,
            targetLocale,
            originalText: text,
            translatedText: formattedText,
            glossaryKept: translationInfo.kept,
            violations: translationInfo.violations,
            processed: true
        };
        
        // Cache kaydet
        this.cache.set(cacheKey, {
            result,
            timestamp: Date.now()
        });
        
        return result;
    }

    resolveUserLocale(requestedLocale, userId) {
        if (requestedLocale !== 'auto') {
            return requestedLocale;
        }
        
        return this.userPreferences.get(userId) || this.config.defaultLocale;
    }

    resolveTargetLocale(requestedLocale, userId, detectedLocale) {
        if (requestedLocale !== 'auto') {
            return requestedLocale;
        }
        
        // Kullanıcı tercihi varsa onu kullan
        const userPref = this.userPreferences.get(userId);
        if (userPref && userPref !== detectedLocale) {
            return userPref;
        }
        
        // Aksi halde tespit edilen dili koru
        return detectedLocale;
    }

    getCacheKey(text, locale, userId) {
        const hash = require('crypto')
            .createHash('md5')
            .update(`${text}#${locale}#${userId}`)
            .digest('hex')
            .slice(0, 8);
        return `i18n:${hash}`;
    }

    startPeriodicTasks() {
        // Cache temizliği her 10 dakika
        setInterval(() => {
            this.cleanupCache();
        }, 600000);
        
        // Metrics yayını her 30 saniye
        setInterval(() => {
            this.emitMetrics();
        }, 30000);
    }

    cleanupCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.config.cache.ttlMs) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            this.logger.info(`I18n cache temizlendi: ${cleaned} entry`);
        }
    }

    emitMetrics() {
        const cacheHitRate = this.stats.detections > 0 ? 
            this.stats.cacheHits / this.stats.detections : 0;
        
        this.emit('i18n.metrics', {
            detections: this.stats.detections,
            translations: this.stats.translations,
            cacheHits: this.stats.cacheHits,
            cacheHitRate: Number(cacheHitRate.toFixed(2)),
            cacheSize: this.cache.size,
            userPreferences: this.userPreferences.size
        });
    }

    emit(eventType, data) {
        eventBus.publishEvent(eventType, {
            timestamp: new Date().toISOString(),
            source: this.name,
            ...data
        }, 'i18nSwitch');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            userPreferences: this.userPreferences.size,
            cacheSize: this.cache.size,
            stats: this.stats,
            supportedLocales: this.config.supported
        };
    }

    async shutdown() {
        this.userPreferences.clear();
        this.cache.clear();
        this.isInitialized = false;
        this.logger?.info(`${this.name} kapatıldı`);
    }
}

module.exports = {
    I18nSwitch,
    i18nSwitch: new I18nSwitch()
};