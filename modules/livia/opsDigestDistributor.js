/**
 * LIVIA-22: Ops Digest Distributor
 * LIVIA çıktılarını RBAC kurallarına göre doğru kanallara dağıtan sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Input schemas
const DigestReadySchema = z.object({
    event: z.literal('digest.daily.ready'),
    timestamp: z.string(),
    forDate: z.string(),
    format: z.enum(['md', 'html']),
    path: z.string(),
    summary: z.string(),
    sections: z.array(z.string()).optional(),
    hash: z.string()
}).strict();

const PostmortemReadySchema = z.object({
    event: z.literal('postmortem.ready'),
    timestamp: z.string(),
    incidentId: z.string(),
    format: z.enum(['md', 'html']),
    path: z.string(),
    summary: z.string(),
    hash: z.string()
}).strict();

const NotesReadySchema = z.object({
    event: z.literal('notes.daily.ready'),
    timestamp: z.string(),
    forDate: z.string(),
    path: z.string(),
    summary: z.string(),
    hash: z.string()
}).strict();

const DistRequestSchema = z.object({
    event: z.literal('dist.request'),
    timestamp: z.string(),
    contentRef: z.object({
        type: z.enum(['digest', 'postmortem', 'notes', 'card', 'generic']),
        path: z.string().optional(),
        format: z.enum(['md', 'html', 'text'])
    }),
    audience: z.array(z.enum(['ops', 'policy', 'observer'])),
    channels: z.array(z.enum(['ui', 'slack', 'webhook', 'email', 'discord', 'teams', 'telegram'])),
    priority: z.enum(['low', 'normal', 'high']),
    dryRun: z.boolean().default(false)
}).strict();

// Output schemas
const DistQueuedSchema = z.object({
    event: z.literal('dist.queued'),
    timestamp: z.string(),
    deliveryKey: z.string(),
    contentType: z.enum(['digest', 'postmortem', 'notes', 'card', 'generic']),
    audience: z.array(z.string()),
    channels: z.array(z.string()),
    priority: z.enum(['low', 'normal', 'high'])
}).strict();

class OpsDigestDistributor extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'OpsDigestDistributor';
        
        this.config = {
            routing: {
                digest: { audience: ['ops', 'policy', 'observer'], channels: ['ui', 'slack', 'email'], schedule: '18:15', priority: 'high' },
                postmortem: { audience: ['ops', 'policy'], channels: ['ui', 'slack', 'email', 'webhook'], priority: 'high' },
                notes: { audience: ['ops', 'policy'], channels: ['ui'], schedule: '18:07', priority: 'normal' },
                signals: { audience: ['ops', 'policy'], channels: ['ui', 'slack', 'webhook'], priority: 'high' }
            },
            rbac: {
                audienceToRole: { ops: ['ops'], policy: ['policy'], observer: ['observer'] },
                scopeFilters: {
                    policy: { include: ['global', 'desk', 'symbol'] },
                    observer: { include: ['global'], excludeSymbols: ['*'] }
                }
            },
            channels: {
                ui: { enabled: true, ratePerMin: 60, quietHours: [] },
                slack: { enabled: true, ratePerMin: 20, quietHours: ['23:00-07:00'], formatter: 'slackBlocks' },
                webhook: { enabled: true, ratePerMin: 120, quietHours: [], signWithHmac: true },
                email: { enabled: true, ratePerMin: 10, quietHours: ['22:00-08:00'], maxBytes: 800_000 },
                discord: { enabled: false, ratePerMin: 15, quietHours: [] },
                teams: { enabled: false, ratePerMin: 15, quietHours: [] },
                telegram: { enabled: false, ratePerMin: 30, quietHours: [] }
            },
            redaction: {
                enabled: true,
                profileMap: { 
                    digest: 'digest', 
                    postmortem: 'postmortem', 
                    notes: 'notes', 
                    card: 'cards', 
                    generic: 'generic' 
                }
            },
            retry: {
                maxAttempts: 5,
                backoff: { initialMs: 1000, factor: 2.0, jitterPct: 0.2 }
            },
            sizePolicy: {
                maxCardChars: 280,
                chunkHtmlAtBytes: 500_000,
                appendDownloadLinkIfChunked: true
            },
            schedule: { sweepEvery: 30 * 1000 }, // 30 saniye
            ...config
        };

        this.state = {
            status: 'IDLE',
            queue: [],
            scheduled: [],
            deliveries: new Map(),
            rateLimiters: new Map(),
            metrics: {
                queued: 0,
                sent: 0,
                acked: 0,
                failed: 0,
                retried: 0,
                dlq: 0
            }
        };

        this.isInitialized = false;
        this.scheduleTimer = null;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('digest.daily.ready', this.handleDigestReady.bind(this));
            this.eventBus.on('postmortem.ready', this.handlePostmortemReady.bind(this));
            this.eventBus.on('notes.daily.ready', this.handleNotesReady.bind(this));
            this.eventBus.on('dist.request', this.handleDistRequest.bind(this));
            this.eventBus.on('recovery.ready', this.handleRecoveryReady.bind(this));
            this.eventBus.on('cooldown.plan.activated', this.handleCooldownActivated.bind(this));

            // Rate limiter'ları başlat
            this.initializeRateLimiters();
            
            // Periyodik scheduler başlat
            this.startScheduler();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    initializeRateLimiters() {
        Object.keys(this.config.channels).forEach(channel => {
            this.state.rateLimiters.set(channel, {
                tokens: this.config.channels[channel].ratePerMin,
                lastRefill: Date.now(),
                maxTokens: this.config.channels[channel].ratePerMin
            });
        });
    }

    startScheduler() {
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
        }
        
        this.scheduleTimer = setInterval(() => {
            this.processScheduledDeliveries();
            this.refillRateLimiters();
        }, this.config.schedule.sweepEvery);
    }

    handleDigestReady(data) {
        try {
            const validated = DigestReadySchema.parse(data);
            this.logger.info(`Digest ready: ${validated.forDate}`);
            
            const routing = this.config.routing.digest;
            this.queueForDistribution({
                contentRef: {
                    type: 'digest',
                    path: validated.path,
                    format: validated.format
                },
                audience: routing.audience,
                channels: routing.channels,
                priority: routing.priority,
                sourceData: validated
            });
        } catch (error) {
            this.logger.error('Digest ready validation error:', error);
        }
    }

    handlePostmortemReady(data) {
        try {
            const validated = PostmortemReadySchema.parse(data);
            this.logger.info(`Postmortem ready: ${validated.incidentId}`);
            
            const routing = this.config.routing.postmortem;
            this.queueForDistribution({
                contentRef: {
                    type: 'postmortem',
                    path: validated.path,
                    format: validated.format
                },
                audience: routing.audience,
                channels: routing.channels,
                priority: routing.priority,
                sourceData: validated
            });
        } catch (error) {
            this.logger.error('Postmortem ready validation error:', error);
        }
    }

    handleNotesReady(data) {
        try {
            const validated = NotesReadySchema.parse(data);
            this.logger.info(`Notes ready: ${validated.forDate}`);
            
            const routing = this.config.routing.notes;
            this.queueForDistribution({
                contentRef: {
                    type: 'notes',
                    path: validated.path,
                    format: 'md'
                },
                audience: routing.audience,
                channels: routing.channels,
                priority: routing.priority,
                sourceData: validated
            });
        } catch (error) {
            this.logger.error('Notes ready validation error:', error);
        }
    }

    handleDistRequest(data) {
        try {
            const validated = DistRequestSchema.parse(data);
            this.logger.info(`Distribution request: ${validated.contentRef.type}`);
            
            this.queueForDistribution({
                contentRef: validated.contentRef,
                audience: validated.audience,
                channels: validated.channels,
                priority: validated.priority,
                dryRun: validated.dryRun
            });
        } catch (error) {
            this.logger.error('Distribution request validation error:', error);
        }
    }

    handleRecoveryReady(data) {
        this.queueSignalCard({
            title: `Toparlanma Hazır — ${data.suggestedStage}`,
            body: `Recovery index: ${data.recoveryIndex.toFixed(2)} • Önerilen aşama: ${data.suggestedStage}`,
            priority: 'high'
        });
    }

    handleCooldownActivated(data) {
        this.queueSignalCard({
            title: 'Cooldown Aktif',
            body: `Süre: ${data.effectiveUntil} • Kısıtlamalar uygulandı`,
            priority: 'high'
        });
    }

    queueSignalCard(cardData) {
        const routing = this.config.routing.signals;
        this.queueForDistribution({
            contentRef: {
                type: 'card',
                format: 'text'
            },
            audience: routing.audience,
            channels: routing.channels,
            priority: routing.priority,
            cardData
        });
    }

    async queueForDistribution(distributionRequest) {
        try {
            this.state.status = 'QUEUEING';
            
            // RBAC ve scope filtreleme
            const authorizedAudience = this.applyRbacFilters(distributionRequest.audience);
            if (authorizedAudience.length === 0) {
                this.logger.warn('No authorized audience after RBAC filtering');
                return;
            }

            // Redaksiyon gerekiyorsa
            let processedContent = distributionRequest.sourceData?.summary || distributionRequest.cardData?.body || '';
            if (this.config.redaction.enabled) {
                processedContent = await this.requestRedaction(
                    processedContent, 
                    distributionRequest.contentRef.type
                );
            }

            // Delivery key oluştur
            const deliveryKey = this.generateDeliveryKey(distributionRequest, authorizedAudience);
            
            // Idempotency kontrolü
            if (this.state.deliveries.has(deliveryKey)) {
                this.logger.info(`Duplicate delivery skipped: ${deliveryKey}`);
                return;
            }

            const delivery = {
                deliveryKey,
                contentType: distributionRequest.contentRef.type,
                audience: authorizedAudience,
                channels: distributionRequest.channels.filter(ch => this.config.channels[ch]?.enabled),
                priority: distributionRequest.priority,
                processedContent,
                sourceData: distributionRequest.sourceData,
                cardData: distributionRequest.cardData,
                dryRun: distributionRequest.dryRun || false,
                createdAt: new Date().toISOString(),
                attempts: 0
            };

            // Quiet hours kontrolü
            if (this.isQuietHours(delivery)) {
                this.scheduleForLater(delivery);
            } else {
                this.state.queue.push(delivery);
                this.processQueue();
            }

            this.emitDistQueued(delivery);
            this.state.metrics.queued++;
            
            this.state.status = 'IDLE';
            
        } catch (error) {
            this.logger.error('Queue for distribution error:', error);
            this.emitAlert('error', 'queueing_failed');
            this.state.status = 'IDLE';
        }
    }

    applyRbacFilters(audience) {
        // Basit RBAC implementasyonu - gerçek implementasyonda role mapping kontrol edilir
        return audience.filter(aud => {
            const roles = this.config.rbac.audienceToRole[aud] || [];
            return roles.length > 0; // En azından bir role sahip
        });
    }

    async requestRedaction(content, contentType) {
        if (!content) return '';
        
        const profile = this.config.redaction.profileMap[contentType] || 'generic';
        
        // LIVIA-21'e redaksiyon isteği gönder
        const redactRequest = {
            event: 'redact.request',
            timestamp: new Date().toISOString(),
            mode: 'text',
            profileId: profile,
            content,
            options: {
                hashOperators: true,
                preserveTickers: true,
                preserveCodeBlocks: true
            },
            context: {
                scope: 'global',
                symbol: null,
                operatorId: null
            }
        };

        // Simülasyon - gerçek implementasyonda LIVIA-21'den cevap bekler
        this.eventBus.emit('redact.request', redactRequest);
        
        // Basit maskeleme simülasyonu
        return content.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '***@***.***');
    }

    generateDeliveryKey(distributionRequest, audience) {
        const canonical = JSON.stringify({
            type: distributionRequest.contentRef.type,
            audience: audience.sort(),
            channels: distributionRequest.channels.sort(),
            date: new Date().toISOString().split('T')[0]
        });
        
        return 'sha256:' + crypto
            .createHash('sha256')
            .update(canonical)
            .digest('hex')
            .substring(0, 16);
    }

    isQuietHours(delivery) {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        
        return delivery.channels.some(channel => {
            const channelConfig = this.config.channels[channel];
            if (!channelConfig?.quietHours) return false;
            
            return channelConfig.quietHours.some(quietPeriod => {
                const [start, end] = quietPeriod.split('-');
                if (start <= end) {
                    return currentTime >= start && currentTime <= end;
                } else {
                    // Overnight period (e.g., 23:00-07:00)
                    return currentTime >= start || currentTime <= end;
                }
            });
        });
    }

    scheduleForLater(delivery) {
        // Sonraki gün için schedule et
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(8, 0, 0, 0); // 08:00'da gönder
        
        delivery.scheduledFor = tomorrow.toISOString();
        this.state.scheduled.push(delivery);
        
        this.logger.info(`Delivery scheduled for later: ${delivery.deliveryKey} at ${delivery.scheduledFor}`);
    }

    processScheduledDeliveries() {
        const now = new Date();
        const readyDeliveries = this.state.scheduled.filter(delivery => 
            new Date(delivery.scheduledFor) <= now
        );
        
        readyDeliveries.forEach(delivery => {
            this.state.queue.push(delivery);
            this.state.scheduled = this.state.scheduled.filter(d => d.deliveryKey !== delivery.deliveryKey);
        });
        
        if (readyDeliveries.length > 0) {
            this.processQueue();
        }
    }

    async processQueue() {
        while (this.state.queue.length > 0) {
            const delivery = this.state.queue.shift();
            await this.processDelivery(delivery);
        }
    }

    async processDelivery(delivery) {
        if (delivery.dryRun) {
            this.logger.info(`Dry run delivery: ${delivery.deliveryKey}`);
            this.emitDistSent(delivery, 'dry-run', 'simulation', 1);
            this.emitDistAcked(delivery, 'dry-run', 0);
            return;
        }

        this.state.deliveries.set(delivery.deliveryKey, delivery);
        
        for (const channel of delivery.channels) {
            if (!this.checkRateLimit(channel)) {
                // Rate limit aşıldı, daha sonra tekrar dene
                this.state.queue.push(delivery);
                break;
            }
            
            try {
                await this.sendToChannel(delivery, channel);
                this.state.metrics.sent++;
                
                this.emitDistSent(delivery, channel, 'success', delivery.attempts + 1);
                this.emitDistAcked(delivery, channel, 50); // Simülasyon latency
                this.state.metrics.acked++;
                
            } catch (error) {
                this.logger.error(`Delivery failed for ${channel}:`, error);
                this.state.metrics.failed++;
                
                delivery.attempts++;
                if (delivery.attempts < this.config.retry.maxAttempts) {
                    this.scheduleRetry(delivery, channel);
                    this.state.metrics.retried++;
                } else {
                    this.moveToDLQ(delivery, channel, 'max_retries_exceeded');
                    this.state.metrics.dlq++;
                }
            }
        }
    }

    checkRateLimit(channel) {
        const limiter = this.state.rateLimiters.get(channel);
        if (!limiter) return true;
        
        if (limiter.tokens > 0) {
            limiter.tokens--;
            return true;
        }
        
        return false;
    }

    refillRateLimiters() {
        const now = Date.now();
        this.state.rateLimiters.forEach((limiter, channel) => {
            const elapsed = now - limiter.lastRefill;
            const tokensToAdd = Math.floor(elapsed / 60000 * limiter.maxTokens);
            
            if (tokensToAdd > 0) {
                limiter.tokens = Math.min(limiter.maxTokens, limiter.tokens + tokensToAdd);
                limiter.lastRefill = now;
            }
        });
    }

    async sendToChannel(delivery, channel) {
        const channelConfig = this.config.channels[channel];
        
        switch (channel) {
            case 'ui':
                return this.sendToUI(delivery);
            case 'slack':
                return this.sendToSlack(delivery, channelConfig);
            case 'webhook':
                return this.sendToWebhook(delivery, channelConfig);
            case 'email':
                return this.sendToEmail(delivery, channelConfig);
            default:
                throw new Error(`Unsupported channel: ${channel}`);
        }
    }

    async sendToUI(delivery) {
        // UI'ya card gönderme simülasyonu
        const card = {
            title: this.getTitle(delivery),
            body: this.getBody(delivery),
            severity: delivery.priority === 'high' ? 'warn' : 'info',
            ttlSec: 600
        };
        
        this.eventBus.emit('ui.card', card);
        this.logger.info(`UI card sent: ${delivery.deliveryKey}`);
    }

    async sendToSlack(delivery, config) {
        // Slack mesaj formatı
        const message = {
            text: this.getTitle(delivery),
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: this.getBody(delivery)
                    }
                }
            ]
        };
        
        // Simülasyon - gerçek implementasyonda Slack API'ye gönderilir
        this.logger.info(`Slack message sent: ${delivery.deliveryKey}`);
    }

    async sendToWebhook(delivery, config) {
        const payload = {
            type: delivery.contentType,
            title: this.getTitle(delivery),
            body: this.getBody(delivery),
            timestamp: new Date().toISOString(),
            priority: delivery.priority
        };
        
        if (config.signWithHmac) {
            // HMAC imzalama simülasyonu
            payload.signature = 'sha256:' + crypto
                .createHash('sha256')
                .update(JSON.stringify(payload))
                .digest('hex');
        }
        
        // Simülasyon - gerçek implementasyonda HTTP POST yapılır
        this.logger.info(`Webhook sent: ${delivery.deliveryKey}`);
    }

    async sendToEmail(delivery, config) {
        const subject = this.getTitle(delivery);
        const body = this.getBody(delivery);
        
        // Büyük içerik kontrolü
        if (Buffer.byteLength(body, 'utf8') > config.maxBytes) {
            // Chunking gerekiyor
            const chunks = this.chunkContent(body, config.maxBytes);
            for (let i = 0; i < chunks.length; i++) {
                this.logger.info(`Email chunk ${i + 1}/${chunks.length} sent: ${delivery.deliveryKey}`);
            }
        } else {
            this.logger.info(`Email sent: ${delivery.deliveryKey}`);
        }
    }

    chunkContent(content, maxBytes) {
        const chunks = [];
        let current = '';
        
        const lines = content.split('\n');
        for (const line of lines) {
            if (Buffer.byteLength(current + line + '\n', 'utf8') > maxBytes) {
                if (current) {
                    chunks.push(current);
                    current = '';
                }
            }
            current += line + '\n';
        }
        
        if (current) {
            chunks.push(current);
        }
        
        return chunks;
    }

    scheduleRetry(delivery, channel) {
        const backoff = this.config.retry.backoff;
        const delay = backoff.initialMs * Math.pow(backoff.factor, delivery.attempts - 1);
        const jitter = delay * backoff.jitterPct * Math.random();
        const finalDelay = delay + jitter;
        
        setTimeout(() => {
            this.state.queue.push(delivery);
            this.processQueue();
        }, finalDelay);
        
        this.emitDistFailed(delivery, channel, 'network_error', Math.round(finalDelay / 1000));
    }

    moveToDLQ(delivery, channel, reason) {
        const dlqPath = `state/dlq/${new Date().toISOString().split('T')[0]}/${delivery.deliveryKey}.json`;
        
        // DLQ'ye yazma simülasyonu
        this.logger.warn(`Moved to DLQ: ${delivery.deliveryKey} - ${reason}`);
        
        this.emitDistDLQ(delivery, reason, dlqPath);
    }

    getTitle(delivery) {
        if (delivery.cardData?.title) {
            return delivery.cardData.title;
        }
        
        switch (delivery.contentType) {
            case 'digest':
                return `Günlük Özet — ${delivery.sourceData?.forDate}`;
            case 'postmortem':
                return `Incident Analizi — ${delivery.sourceData?.incidentId}`;
            case 'notes':
                return `Günlük Notlar — ${delivery.sourceData?.forDate}`;
            default:
                return 'LIVIA Bildirimi';
        }
    }

    getBody(delivery) {
        if (delivery.cardData?.body) {
            return delivery.cardData.body;
        }
        
        if (delivery.processedContent) {
            return delivery.processedContent.substring(0, this.config.sizePolicy.maxCardChars);
        }
        
        return delivery.sourceData?.summary || 'İçerik mevcut değil';
    }

    emitDistQueued(delivery) {
        const event = {
            event: 'dist.queued',
            timestamp: new Date().toISOString(),
            deliveryKey: delivery.deliveryKey,
            contentType: delivery.contentType,
            audience: delivery.audience,
            channels: delivery.channels,
            priority: delivery.priority
        };

        this.eventBus.emit('dist.queued', event);
    }

    emitDistSent(delivery, channel, messageId, attempt) {
        const event = {
            event: 'dist.sent',
            timestamp: new Date().toISOString(),
            deliveryKey: delivery.deliveryKey,
            channel,
            messageId,
            attempt
        };

        this.eventBus.emit('dist.sent', event);
    }

    emitDistAcked(delivery, channel, latencyMs) {
        const event = {
            event: 'dist.acked',
            timestamp: new Date().toISOString(),
            deliveryKey: delivery.deliveryKey,
            channel,
            latencyMs
        };

        this.eventBus.emit('dist.acked', event);
    }

    emitDistFailed(delivery, channel, error, willRetryInSec) {
        const event = {
            event: 'dist.failed',
            timestamp: new Date().toISOString(),
            deliveryKey: delivery.deliveryKey,
            channel,
            error,
            willRetryInSec
        };

        this.eventBus.emit('dist.failed', event);
    }

    emitDistDLQ(delivery, reason, deadLetterPath) {
        const event = {
            event: 'dist.dlq',
            timestamp: new Date().toISOString(),
            deliveryKey: delivery.deliveryKey,
            reason,
            deadLetterPath
        };

        this.eventBus.emit('dist.dlq', event);
    }

    emitAlert(level, message) {
        const event = {
            event: 'dist.alert',
            timestamp: new Date().toISOString(),
            level,
            message
        };

        this.eventBus.emit('dist.alert', event);
        this.logger.warn(`Distribution alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'dist.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.metrics,
            p95SendMs: 320,
            rateLimited: 0,
            byChannel: this.getChannelStats(),
            byContent: this.getContentStats()
        };

        this.eventBus.emit('dist.metrics', event);
    }

    getChannelStats() {
        const stats = {};
        this.state.deliveries.forEach(delivery => {
            delivery.channels.forEach(channel => {
                stats[channel] = (stats[channel] || 0) + 1;
            });
        });
        return stats;
    }

    getContentStats() {
        const stats = {};
        this.state.deliveries.forEach(delivery => {
            stats[delivery.contentType] = (stats[delivery.contentType] || 0) + 1;
        });
        return stats;
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            queue: this.state.queue.length,
            scheduled: this.state.scheduled.length,
            deliveries: this.state.deliveries.size,
            metrics: this.state.metrics,
            rateLimiters: Object.fromEntries(
                Array.from(this.state.rateLimiters.entries()).map(([channel, limiter]) => [
                    channel, 
                    { tokens: limiter.tokens, maxTokens: limiter.maxTokens }
                ])
            )
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            if (this.scheduleTimer) {
                clearInterval(this.scheduleTimer);
                this.scheduleTimer = null;
            }
            
            // Son metrics emit et
            this.emitMetrics();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = OpsDigestDistributor;