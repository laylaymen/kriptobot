/**
 * LIVIA-21: PII Guard and Redactor
 * PII tespit ve maskeleme sistemi - streaming redaksiyon ile güvenli içerik üretimi
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Input schemas
const RedactRequestSchema = z.object({
    event: z.literal('redact.request'),
    timestamp: z.string(),
    mode: z.enum(['markdown', 'html', 'text']),
    profileId: z.enum(['digest', 'postmortem', 'notes', 'cards', 'generic']),
    content: z.string(),
    options: z.object({
        hashOperators: z.boolean().default(true),
        hashSalt: z.string().default('rotate-me-daily'),
        classify: z.boolean().default(true),
        maskEmail: z.boolean().default(true),
        maskPhone: z.boolean().default(true),
        maskWallet: z.boolean().default(true),
        maskIBAN: z.boolean().default(true),
        maskGovId: z.boolean().default(true),
        preserveTickers: z.boolean().default(true),
        preserveCodeBlocks: z.boolean().default(true),
        preservePaths: z.boolean().default(true)
    }).default({}),
    context: z.object({
        scope: z.enum(['global', 'desk', 'symbol']),
        symbol: z.string().nullable(),
        operatorId: z.string().nullable()
    }).default({ scope: 'global', symbol: null, operatorId: null })
}).strict();

const DictionaryUpdateSchema = z.object({
    event: z.literal('redact.dictionary.update'),
    timestamp: z.string(),
    allowlistTickers: z.array(z.string()).optional(),
    allowlistDomains: z.array(z.string()).optional(),
    denylistUsernames: z.array(z.string()).optional()
}).strict();

// Output schemas
const RedactReadySchema = z.object({
    event: z.literal('redact.ready'),
    timestamp: z.string(),
    profileId: z.enum(['digest', 'postmortem', 'notes', 'cards', 'generic']),
    mode: z.enum(['markdown', 'html', 'text']),
    classification: z.enum(['PUBLIC', 'SENSITIVE_LOW', 'SENSITIVE_HIGH']),
    maskedContent: z.string(),
    stats: z.object({
        entitiesFound: z.object({
            email: z.number(),
            phone: z.number(),
            iban: z.number(),
            wallet: z.number(),
            govId: z.number(),
            name: z.number()
        }),
        falsePositiveAvoided: z.object({
            ticker: z.number(),
            codeBlock: z.number(),
            path: z.number()
        }),
        bytesIn: z.number(),
        bytesOut: z.number()
    }),
    hash: z.string()
}).strict();

class PiiGuardAndRedactor extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'PiiGuardAndRedactor';
        
        this.config = {
            profiles: {
                digest: { preserveCodeBlocks: true, preservePaths: true, preserveTickers: true, aggressive: false },
                postmortem: { preserveCodeBlocks: true, preservePaths: true, preserveTickers: true, aggressive: true },
                notes: { preserveCodeBlocks: true, preservePaths: true, preserveTickers: true, aggressive: false },
                cards: { preserveCodeBlocks: false, preservePaths: false, preserveTickers: true, aggressive: false },
                generic: { preserveCodeBlocks: true, preservePaths: true, preserveTickers: true, aggressive: false }
            },
            patterns: {
                email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
                phoneIntl: /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3}[\s-]?\d{2,4}/g,
                iban: /\bTR\d{24}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{1,30}\b/g,
                govId: /\b\d{11}\b/g,
                btc: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,
                eth: /\b0x[a-fA-F0-9]{40}\b/g,
                tron: /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g,
                nameLike: /(?:ad[ıi]|soyad[ıi]|isim|name)\s*[:=]\s*([\p{L}\s'-]{2,})/giu
            },
            allowlists: {
                tickers: ['AVAX', 'SOL', 'BTC', 'AVAXUSDT', 'SOLUSDT', 'ETHUSDT', 'BNBUSDT'],
                systemPathsPrefix: ['data/notes/', 'data/digest/', 'data/postmortem/', 'logs/', 'config/'],
                codeFence: ['```', '~~~', '<code>', '</code>']
            },
            masking: {
                email: 'local***@***.domain',
                phone: '+** *** *** ** **',
                iban: '****-****-****-****',
                wallet: '0x***masked***',
                govId: '***-***-***',
                name: 'user:#{hash}',
                operatorHashSalt: 'rotate-me-daily',
                hashAlgo: 'sha256'
            },
            classification: {
                defaultLevel: 'SENSITIVE_LOW',
                elevateIfFound: ['email', 'phone', 'iban', 'wallet', 'govId', 'name'],
                downgradeIfOnly: ['ticker', 'path', 'codeBlock']
            },
            streaming: {
                chunkBytes: 16384,
                overlapBytes: 128,
                maxBytes: 2_000_000
            },
            ...config
        };

        this.state = {
            status: 'IDLE',
            dictionary: {
                allowlistTickers: [...this.config.allowlists.tickers],
                allowlistDomains: [],
                denylistUsernames: []
            },
            processingStats: {
                processed: 0,
                avgDetectMs: 0,
                avgMaskMs: 0,
                streamedPct: 0,
                fpRate: 0,
                fnRate: 0
            }
        };

        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('redact.request', this.handleRedactRequest.bind(this));
            this.eventBus.on('redact.dictionary.update', this.handleDictionaryUpdate.bind(this));

            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    async handleRedactRequest(data) {
        try {
            const validated = RedactRequestSchema.parse(data);
            await this.processRedactionRequest(validated);
        } catch (error) {
            this.logger.error('Redact request validation error:', error);
            this.emitAlert('error', 'validation_failed');
        }
    }

    handleDictionaryUpdate(data) {
        try {
            const validated = DictionaryUpdateSchema.parse(data);
            this.updateDictionary(validated);
        } catch (error) {
            this.logger.error('Dictionary update validation error:', error);
        }
    }

    updateDictionary(update) {
        if (update.allowlistTickers) {
            this.state.dictionary.allowlistTickers = [...update.allowlistTickers];
        }
        if (update.allowlistDomains) {
            this.state.dictionary.allowlistDomains = [...update.allowlistDomains];
        }
        if (update.denylistUsernames) {
            this.state.dictionary.denylistUsernames = [...update.denylistUsernames];
        }
        
        this.logger.info('PII dictionary updated');
    }

    async processRedactionRequest(request) {
        if (!this.isInitialized) {
            this.emitAlert('error', 'not_initialized');
            return;
        }

        try {
            this.state.status = 'PROCESSING';
            const startTime = Date.now();
            
            // Profile ayarlarını al
            const profileConfig = this.getProfileConfig(request.profileId);
            const mergedOptions = { ...profileConfig, ...request.options };
            
            // İçerik çok büyükse appendix uyarısı
            if (request.content.length > this.config.streaming.maxBytes) {
                this.logger.warn(`Large content detected: ${request.content.length} bytes`);
            }
            
            // Streaming redaksiyon işlemi
            const result = await this.streamingRedaction(request.content, request.mode, mergedOptions);
            
            // İstatistikleri hesapla
            const stats = this.calculateStats(request.content, result.maskedContent, result.detectionStats);
            
            // Sınıflandırma
            const classification = this.classifyContent(result.detectionStats);
            
            // Hash hesapla
            const hash = this.calculateContentHash(result.maskedContent);
            
            // Sonuç emit et
            this.emitRedactReady(request, result.maskedContent, classification, stats, hash);
            
            // Performans metrikleri güncelle
            const processingTime = Date.now() - startTime;
            this.updatePerformanceStats(processingTime);
            
            this.state.status = 'IDLE';
            
        } catch (error) {
            this.logger.error('Redaction processing error:', error);
            this.emitAlert('error', 'processing_failed');
            this.state.status = 'IDLE';
        }
    }

    getProfileConfig(profileId) {
        return this.config.profiles[profileId] || this.config.profiles.generic;
    }

    async streamingRedaction(content, mode, options) {
        const chunks = this.chunkContent(content);
        const detectionStats = this.initDetectionStats();
        let maskedContent = '';
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkResult = await this.processChunk(chunk, mode, options, detectionStats);
            
            // Overlap handling için son chunk ise tam olarak ekle, değilse overlap'i çıkar
            if (i === chunks.length - 1) {
                maskedContent += chunkResult.masked;
            } else {
                const overlapStart = chunkResult.masked.length - this.config.streaming.overlapBytes;
                maskedContent += chunkResult.masked.substring(0, overlapStart);
            }
        }
        
        return {
            maskedContent,
            detectionStats
        };
    }

    chunkContent(content) {
        const chunks = [];
        const chunkSize = this.config.streaming.chunkBytes;
        const overlapSize = this.config.streaming.overlapBytes;
        
        for (let i = 0; i < content.length; i += chunkSize - overlapSize) {
            const end = Math.min(i + chunkSize, content.length);
            chunks.push(content.substring(i, end));
        }
        
        return chunks;
    }

    async processChunk(chunk, mode, options, stats) {
        let masked = chunk;
        
        // Mode'a göre preprocessing
        if (mode === 'markdown') {
            masked = this.preprocessMarkdown(masked, options);
        } else if (mode === 'html') {
            masked = this.preprocessHtml(masked, options);
        }
        
        // PII detection ve masking
        masked = this.detectAndMask(masked, options, stats);
        
        return { masked };
    }

    preprocessMarkdown(content, options) {
        // Code block'ları koru
        if (options.preserveCodeBlocks) {
            content = content.replace(/```[\s\S]*?```/g, (match) => {
                return this.processCodeBlock(match, options);
            });
            
            content = content.replace(/`[^`]+`/g, (match) => {
                return this.processInlineCode(match, options);
            });
        }
        
        return content;
    }

    preprocessHtml(content, options) {
        // HTML code tag'lerini koru
        if (options.preserveCodeBlocks) {
            content = content.replace(/<code[^>]*>[\s\S]*?<\/code>/gi, (match) => {
                return this.processCodeBlock(match, options);
            });
        }
        
        return content;
    }

    processCodeBlock(codeBlock, options) {
        // Code block içinde sadece wallet ve IBAN maskelenir
        let processed = codeBlock;
        
        if (options.maskWallet) {
            processed = processed.replace(this.config.patterns.btc, this.config.masking.wallet);
            processed = processed.replace(this.config.patterns.eth, this.config.masking.wallet);
            processed = processed.replace(this.config.patterns.tron, this.config.masking.wallet);
        }
        
        if (options.maskIBAN) {
            processed = processed.replace(this.config.patterns.iban, this.config.masking.iban);
        }
        
        return processed;
    }

    processInlineCode(inlineCode, options) {
        // Inline code daha konservatif yaklaşım - sadece açık PII'ları maskele
        return inlineCode;
    }

    detectAndMask(content, options, stats) {
        let masked = content;
        
        // Email masking
        if (options.maskEmail) {
            masked = masked.replace(this.config.patterns.email, (match) => {
                if (this.isAllowedDomain(match)) {
                    stats.falsePositiveAvoided.email++;
                    return match;
                }
                stats.entitiesFound.email++;
                return this.maskEmail(match);
            });
        }
        
        // Phone masking
        if (options.maskPhone) {
            masked = masked.replace(this.config.patterns.phoneIntl, (match) => {
                stats.entitiesFound.phone++;
                return this.config.masking.phone;
            });
        }
        
        // IBAN masking
        if (options.maskIBAN) {
            masked = masked.replace(this.config.patterns.iban, (match) => {
                stats.entitiesFound.iban++;
                return this.config.masking.iban;
            });
        }
        
        // Wallet masking
        if (options.maskWallet) {
            [this.config.patterns.btc, this.config.patterns.eth, this.config.patterns.tron].forEach(pattern => {
                masked = masked.replace(pattern, (match) => {
                    stats.entitiesFound.wallet++;
                    return this.config.masking.wallet;
                });
            });
        }
        
        // Government ID masking
        if (options.maskGovId) {
            masked = masked.replace(this.config.patterns.govId, (match) => {
                stats.entitiesFound.govId++;
                return this.config.masking.govId;
            });
        }
        
        // Name-like pattern masking
        masked = masked.replace(this.config.patterns.nameLike, (match, name) => {
            stats.entitiesFound.name++;
            const hash = this.hashString(name, options.hashSalt);
            return match.replace(name, `user:${hash}`);
        });
        
        // Ticker koruması - yanlış pozitif önleme
        if (options.preserveTickers) {
            this.state.dictionary.allowlistTickers.forEach(ticker => {
                const tickerPattern = new RegExp(`\\b${ticker}\\b`, 'gi');
                const matches = (content.match(tickerPattern) || []).length;
                stats.falsePositiveAvoided.ticker += matches;
            });
        }
        
        // System path koruması
        if (options.preservePaths) {
            this.config.allowlists.systemPathsPrefix.forEach(prefix => {
                const pathPattern = new RegExp(`${prefix}[\\w/.-]+`, 'g');
                const matches = (content.match(pathPattern) || []).length;
                stats.falsePositiveAvoided.path += matches;
            });
        }
        
        return masked;
    }

    isAllowedDomain(email) {
        const domain = email.split('@')[1];
        return this.state.dictionary.allowlistDomains.includes(domain);
    }

    maskEmail(email) {
        const [local, domain] = email.split('@');
        const maskedLocal = local.length > 3 ? local.substring(0, 2) + '***' : '***';
        const maskedDomain = domain.length > 6 ? '***.' + domain.split('.').pop() : '***.domain';
        return `${maskedLocal}@${maskedDomain}`;
    }

    hashString(input, salt) {
        const date = new Date().toISOString().split('T')[0];
        const combined = `${input}-${salt}-${date}`;
        return crypto
            .createHash(this.config.masking.hashAlgo)
            .update(combined)
            .digest('hex')
            .substring(0, 6);
    }

    initDetectionStats() {
        return {
            entitiesFound: {
                email: 0,
                phone: 0,
                iban: 0,
                wallet: 0,
                govId: 0,
                name: 0
            },
            falsePositiveAvoided: {
                email: 0,
                ticker: 0,
                codeBlock: 0,
                path: 0
            }
        };
    }

    calculateStats(originalContent, maskedContent, detectionStats) {
        return {
            entitiesFound: detectionStats.entitiesFound,
            falsePositiveAvoided: detectionStats.falsePositiveAvoided,
            bytesIn: Buffer.byteLength(originalContent, 'utf8'),
            bytesOut: Buffer.byteLength(maskedContent, 'utf8')
        };
    }

    classifyContent(detectionStats) {
        const sensitiveEntities = this.config.classification.elevateIfFound;
        const hasSensitiveData = sensitiveEntities.some(entity => 
            detectionStats.entitiesFound[entity] > 0
        );
        
        if (hasSensitiveData) {
            return 'SENSITIVE_HIGH';
        }
        
        const onlyPreservedData = Object.values(detectionStats.entitiesFound).every(count => count === 0) &&
                                  Object.values(detectionStats.falsePositiveAvoided).some(count => count > 0);
        
        if (onlyPreservedData) {
            return 'PUBLIC';
        }
        
        return this.config.classification.defaultLevel;
    }

    calculateContentHash(content) {
        return 'sha256:' + crypto
            .createHash('sha256')
            .update(content)
            .digest('hex')
            .substring(0, 16);
    }

    updatePerformanceStats(processingTime) {
        this.state.processingStats.processed++;
        
        // Moving average için basit güncelleme
        const alpha = 0.1;
        this.state.processingStats.avgDetectMs = 
            alpha * processingTime + (1 - alpha) * this.state.processingStats.avgDetectMs;
    }

    emitRedactReady(request, maskedContent, classification, stats, hash) {
        const event = {
            event: 'redact.ready',
            timestamp: new Date().toISOString(),
            profileId: request.profileId,
            mode: request.mode,
            classification,
            maskedContent,
            stats,
            hash
        };

        this.eventBus.emit('redact.ready', event);
        this.logger.info(`Redaction completed: ${classification}, ${stats.entitiesFound.email + stats.entitiesFound.phone + stats.entitiesFound.iban + stats.entitiesFound.wallet + stats.entitiesFound.govId + stats.entitiesFound.name} entities masked`);
    }

    emitAlert(level, message) {
        const event = {
            event: 'redact.alert',
            timestamp: new Date().toISOString(),
            level,
            message
        };

        this.eventBus.emit('redact.alert', event);
        this.logger.warn(`Redact alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'redact.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.processingStats,
            byProfile: this.getProfileStats()
        };

        this.eventBus.emit('redact.metrics', event);
    }

    getProfileStats() {
        // Bu basit implementasyonda profile stats tracking yok
        // Gerçek implementasyonda her profile için ayrı sayaçlar tutulabilir
        return {};
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            processingStats: this.state.processingStats,
            dictionarySize: {
                allowlistTickers: this.state.dictionary.allowlistTickers.length,
                allowlistDomains: this.state.dictionary.allowlistDomains.length,
                denylistUsernames: this.state.dictionary.denylistUsernames.length
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = PiiGuardAndRedactor;