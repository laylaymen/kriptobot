/**
 * LIVIA-11 · promptTemplateRegistry.js
 * Akıllı şablon kayıt defteri - Sürümlü ve çok dilli metin şablonları
 */

const { z } = require('zod');
const { eventBus } = require('../modularEventStream');
const { logInfo, logError } = require('../../logs/logger');

// 🎯 Smart Schemas - Sadece gerekli olanlar
const TemplateSchema = z.object({
    id: z.string(),
    version: z.string().default('1.0.0'),
    locale: z.enum(['tr', 'en']).default('tr'),
    kind: z.enum(['prompt', 'question', 'report', 'card']),
    body: z.string(),
    variables: z.record(z.any()).default({}),
    meta: z.object({
        maxChars: z.number().optional(),
        tags: z.array(z.string()).default([])
    }).default({})
});

const EventSchema = z.object({
    event: z.string(),
    data: z.any(),
    auth: z.object({
        userId: z.string(),
        roles: z.array(z.string())
    })
});

/**
 * 🚀 Smart Template Engine
 */
class SmartTemplateEngine {
    render(template, vars = {}) {
        let result = template;
        
        // Simple variable replacement
        for (const [key, value] of Object.entries(vars)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            result = result.replace(regex, String(value));
        }
        
        return result;
    }
    
    validate(template, vars) {
        const required = [...template.matchAll(/{{(\w+)}}/g)].map(m => m[1]);
        const missing = required.filter(r => !(r in vars));
        
        return {
            valid: missing.length === 0,
            missing,
            length: template.length
        };
    }
}

/**
 * 🎯 LIVIA-11 Smart Template Registry
 */
class PromptTemplateRegistry {
    constructor(config = {}) {
        this.name = 'PromptTemplateRegistry';
        this.config = {
            maxChars: { prompt: 800, question: 500, report: 2000, card: 280 },
            defaultLocale: 'tr',
            rbac: { read: ['trader', 'ops'], write: ['ops'] },
            ...config
        };
        
        this.templates = new Map(); // Fast in-memory storage
        this.userLocales = new Map(); // User locale preferences
        this.engine = new SmartTemplateEngine();
        this.stats = { stores: 0, gets: 0, renders: 0 };
        
        this.isInitialized = false;
        this.logger = null;
    }

    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Store template
        eventBus.subscribeToEvent('template.store', (event) => {
            this.handleStore(event.data);
        }, 'promptTemplateRegistry');
        
        // Get template
        eventBus.subscribeToEvent('template.get', (event) => {
            this.handleGet(event.data);
        }, 'promptTemplateRegistry');
        
        // Render template
        eventBus.subscribeToEvent('template.render', (event) => {
            this.handleRender(event.data);
        }, 'promptTemplateRegistry');
        
        // Set locale preference
        eventBus.subscribeToEvent('user.locale.set', (event) => {
            this.userLocales.set(event.data.userId, event.data.locale);
        }, 'promptTemplateRegistry');
    }

    async handleStore(data) {
        try {
            const event = EventSchema.parse(data);
            
            // RBAC check
            if (!this.hasWriteAccess(event.auth.roles)) {
                this.emit('template.error', { error: 'no_write_access' });
                return;
            }
            
            const template = TemplateSchema.parse(event.data.template);
            
            // Smart validation
            const validation = this.validateTemplate(template);
            if (!validation.valid) {
                this.emit('template.error', { error: 'validation_failed', details: validation.errors });
                return;
            }
            
            // Store with smart key
            const key = `${template.id}#${template.version}#${template.locale}`;
            this.templates.set(key, {
                ...template,
                stored: Date.now(),
                checksum: this.getChecksum(template)
            });
            
            this.stats.stores++;
            this.emit('template.stored', { key, template });
            
        } catch (error) {
            this.logger.error('Store error:', error);
            this.emit('template.error', { error: error.message });
        }
    }

    async handleGet(data) {
        try {
            const event = EventSchema.parse(data);
            const { id, version = 'latest', locale = 'auto' } = event.data;
            
            // Resolve locale
            const userLocale = this.userLocales.get(event.auth.userId) || this.config.defaultLocale;
            const resolvedLocale = locale === 'auto' ? userLocale : locale;
            
            // Try to find template
            let template = this.findTemplate(id, version, resolvedLocale);
            
            // Fallback to default locale
            if (!template && resolvedLocale !== this.config.defaultLocale) {
                template = this.findTemplate(id, version, this.config.defaultLocale);
            }
            
            this.stats.gets++;
            
            if (template) {
                this.emit('template.found', { template, resolvedLocale });
            } else {
                this.emit('template.not_found', { id, version, locale: resolvedLocale });
            }
            
        } catch (error) {
            this.logger.error('Get error:', error);
            this.emit('template.error', { error: error.message });
        }
    }

    async handleRender(data) {
        try {
            const event = EventSchema.parse(data);
            const { id, version = 'latest', locale = 'auto', variables = {} } = event.data;
            
            // Get template first
            const template = await this.getTemplate(id, version, locale, event.auth.userId);
            if (!template) {
                this.emit('template.render_error', { error: 'template_not_found' });
                return;
            }
            
            // Render with smart engine
            const validation = this.engine.validate(template.body, variables);
            if (!validation.valid) {
                this.emit('template.render_error', { 
                    error: 'missing_variables', 
                    missing: validation.missing 
                });
                return;
            }
            
            const rendered = this.engine.render(template.body, variables);
            
            // Length check
            const maxLen = this.config.maxChars[template.kind] || 1000;
            const warnings = rendered.length > maxLen ? [`Length ${rendered.length} > ${maxLen}`] : [];
            
            this.stats.renders++;
            this.emit('template.rendered', { 
                rendered, 
                length: rendered.length, 
                warnings,
                template: { id: template.id, version: template.version }
            });
            
        } catch (error) {
            this.logger.error('Render error:', error);
            this.emit('template.render_error', { error: error.message });
        }
    }

    // 🎯 Core helpers - akıllı ve hızlı
    findTemplate(id, version, locale) {
        if (version === 'latest') {
            // Find latest version for this id/locale
            const candidates = Array.from(this.templates.entries())
                .filter(([key]) => key.startsWith(`${id}#`) && key.endsWith(`#${locale}`))
                .map(([key, template]) => ({ key, template, version: template.version }))
                .sort((a, b) => this.compareVersions(b.version, a.version));
            
            return candidates[0]?.template;
        } else {
            const key = `${id}#${version}#${locale}`;
            return this.templates.get(key);
        }
    }

    async getTemplate(id, version, locale, userId) {
        const userLocale = this.userLocales.get(userId) || this.config.defaultLocale;
        const resolvedLocale = locale === 'auto' ? userLocale : locale;
        
        let template = this.findTemplate(id, version, resolvedLocale);
        if (!template && resolvedLocale !== this.config.defaultLocale) {
            template = this.findTemplate(id, version, this.config.defaultLocale);
        }
        
        return template;
    }

    validateTemplate(template) {
        const errors = [];
        
        // Required fields
        if (!template.id || !template.body) {
            errors.push('id and body required');
        }
        
        // Length check
        const maxLen = this.config.maxChars[template.kind] || 1000;
        if (template.body.length > maxLen) {
            errors.push(`Body too long: ${template.body.length} > ${maxLen}`);
        }
        
        // Variable check
        const variables = [...(template.body.match(/{{(\w+)}}/g) || [])].map(v => v.slice(2, -2));
        const declared = Object.keys(template.variables || {});
        const undeclared = variables.filter(v => !declared.includes(v));
        
        if (undeclared.length > 0) {
            errors.push(`Undeclared variables: ${undeclared.join(', ')}`);
        }
        
        return { valid: errors.length === 0, errors };
    }

    compareVersions(a, b) {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
        
        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    }

    hasWriteAccess(roles) {
        return this.config.rbac.write.some(role => roles.includes(role));
    }

    getChecksum(template) {
        return require('crypto')
            .createHash('md5')
            .update(JSON.stringify(template))
            .digest('hex')
            .slice(0, 8);
    }

    emit(eventType, data) {
        eventBus.publishEvent(eventType, {
            timestamp: new Date().toISOString(),
            source: this.name,
            ...data
        }, 'promptTemplateRegistry');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            templatesCount: this.templates.size,
            userLocales: this.userLocales.size,
            stats: this.stats
        };
    }

    async shutdown() {
        this.templates.clear();
        this.userLocales.clear();
        this.isInitialized = false;
        this.logger?.info(`${this.name} kapatıldı`);
    }
}

module.exports = {
    PromptTemplateRegistry,
    promptTemplateRegistry: new PromptTemplateRegistry()
};

module.exports = {
    PromptTemplateRegistry,
    promptTemplateRegistry: new PromptTemplateRegistry(),
    TemplateValidator,
    TemplateRenderer,
    TemplateStorage
};