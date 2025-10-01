/**
 * LIVIA-26 · ethicsAndComplianceGate.js
 * Etik ve uyum kontrol kapısı modülü
 */

class EthicsAndComplianceGate {
    constructor(config = {}) {
        this.name = 'EthicsAndComplianceGate';
        this.config = {
            enabled: true,
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            rules: {
                geoRestrictedCountries: ['US', 'IR', 'KP', 'SY', 'CU', 'RU'],
                requireKycLevel: 'passed',
                vpnBlocked: true,
                blackoutWindows: ['22:00-07:00'],
                restrictedSymbols: ['XYZUSDT'],
                leverageCapsByJurisdiction: { 'DE': 2, 'TR': 5, 'US': 0 },
                marketAbusePatterns: ['spoofing', 'layering', 'wash_trade'],
                dataExportRequiresConsent: true
            },
            sanctions: {
                providers: ['ofac', 'un', 'uk_hmt'],
                timeoutMs: 1200,
                cacheTtlSec: 3600,
                failClosed: true
            },
            enforcement: {
                onSanctionsHit: 'halt',
                onGeoRestricted: 'block',
                onVpnSuspected: 'allow_with_limits',
                onBlackout: 'block',
                onAbusePatternHigh: 'halt',
                defaultRateLimitPerMin: 5,
                defaultPositionLimitFactor: 0.7
            },
            approvals: {
                overrideGateway: 'LIVIA-05',
                requireForDecisions: ['allow_with_limits>30min', 'override_geo_restriction', 'override_blackout']
            },
            storage: {
                wormDir: 'state/ethics/worm/{YYYY-MM-DD}',
                hashChainFile: 'chain.log'
            },
            redactionProfile: 'generic',
            distroChannels: ['ui', 'slack'],
            schedule: { sweepEvery: '1m' },
            idempotencyTtlSec: 3600,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.ethicsStore = new Map();
        this.hashChain = [];
        this.contextCache = {
            kycStatuses: new Map(),
            amlHits: new Map(),
            geoIpData: new Map(),
            marketPatterns: new Map(),
            consentLogs: new Map(),
            sanctionsCache: new Map()
        };
        this.sweepInterval = null;
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setup();
            this.setupEventListeners();
            this.startScheduler();
            this.loadHashChain();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    async setup() {
        if (this.config.enabled) {
            await this.initializeWormStorage();
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Ana tetikleyici event'ler
        this.eventBus.on('action.intent', (data) => this.handleActionIntent(data));
        this.eventBus.on('policy.change.request', (data) => this.handlePolicyChangeRequest(data));
        
        // Context güncellemeleri
        this.eventBus.on('kyc.status', (data) => this.handleKycStatus(data));
        this.eventBus.on('aml.hit', (data) => this.handleAmlHit(data));
        this.eventBus.on('geoip.update', (data) => this.handleGeoIpUpdate(data));
        this.eventBus.on('market.pattern.detected', (data) => this.handleMarketPattern(data));
        this.eventBus.on('blacklist.update', (data) => this.handleBlacklistUpdate(data));
        this.eventBus.on('consent.log', (data) => this.handleConsentLog(data));
        
        // Override event'leri
        this.eventBus.on('approval.granted', (data) => this.handleApprovalGranted(data));
        this.eventBus.on('approval.rejected', (data) => this.handleApprovalRejected(data));
    }

    startScheduler() {
        const intervalMs = this.parseScheduleInterval(this.config.schedule.sweepEvery);
        this.sweepInterval = setInterval(() => {
            this.performScheduledSweep();
        }, intervalMs);
    }

    parseScheduleInterval(interval) {
        if (interval.endsWith('m')) {
            return parseInt(interval) * 60 * 1000;
        }
        if (interval.endsWith('s')) {
            return parseInt(interval) * 1000;
        }
        return 60 * 1000; // Default 1 dakika
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processEthicsGate(data);
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        } catch (error) {
            this.logger.error(`${this.name} işlem hatası:`, error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        }
    }

    async processEthicsGate(data) {
        const ethicsKey = this.generateEthicsKey(data);
        
        // Idempotency kontrolü
        if (this.ethicsStore.has(ethicsKey)) {
            const cached = this.ethicsStore.get(ethicsKey);
            if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                return cached.result;
            }
        }

        // Etik değerlendirme
        const result = await this.evaluateEthics(data);
        
        // Cache'e kaydet
        this.ethicsStore.set(ethicsKey, {
            result,
            timestamp: Date.now()
        });

        return result;
    }

    async evaluateEthics(data) {
        this.logger.debug(`Etik değerlendirme başlatılıyor: ${data.actionId || 'unknown'}`);
        
        // Context topla
        const context = await this.buildContext(data);
        
        // Kuralları değerlendir
        const evaluation = await this.evaluateRules(data, context);
        
        // Karar ver
        const decision = this.makeDecision(evaluation);
        
        // WORM'a kaydet
        await this.appendToWorm(decision, data);
        
        // Event'leri yayınla
        await this.emitEthicsEvents(decision, data);
        
        return decision;
    }

    async buildContext(data) {
        const operatorId = data.actor?.operatorId;
        const symbol = data.symbol;
        const origin = data.origin;
        
        const context = {
            kyc: operatorId ? this.contextCache.kycStatuses.get(operatorId) : null,
            aml: operatorId ? this.contextCache.amlHits.get(operatorId) : null,
            geoip: operatorId ? this.contextCache.geoIpData.get(operatorId) : null,
            marketPatterns: symbol ? this.contextCache.marketPatterns.get(symbol) : null,
            consent: operatorId ? this.contextCache.consentLogs.get(operatorId) : null,
            sanctions: await this.checkSanctions(data.actor),
            currentTime: new Date(),
            timeZone: this.config.i18n.tz
        };
        
        return context;
    }

    async evaluateRules(data, context) {
        const evaluation = {
            violations: [],
            warnings: [],
            score: 1.0
        };

        // KYC kontrolü
        if (this.config.rules.requireKycLevel === 'passed') {
            if (!context.kyc || context.kyc.level !== 'passed') {
                evaluation.violations.push('kyc_not_passed');
                evaluation.score *= 0.0; // Hard block
            }
        }

        // Sanctions kontrolü
        if (context.sanctions && context.sanctions.confidence >= 0.9) {
            evaluation.violations.push('sanctions_hit');
            evaluation.score *= 0.0; // Hard block
        }

        // Geo restriction kontrolü
        if (context.geoip && this.config.rules.geoRestrictedCountries.includes(context.geoip.country)) {
            evaluation.violations.push('geo_restricted');
            evaluation.score *= 0.2;
        }

        // VPN kontrolü
        if (context.geoip && context.geoip.vpn_suspected && this.config.rules.vpnBlocked) {
            evaluation.warnings.push('vpn_suspected');
            evaluation.score *= 0.5;
        }

        // Blackout window kontrolü
        if (this.isInBlackoutWindow(context.currentTime)) {
            evaluation.violations.push('blackout_window');
            evaluation.score *= 0.1;
        }

        // Restricted symbols kontrolü
        if (data.symbol && this.config.rules.restrictedSymbols.includes(data.symbol)) {
            evaluation.violations.push('restricted_symbol');
            evaluation.score *= 0.0;
        }

        // Leverage cap kontrolü
        if (data.payload?.leverage && context.geoip) {
            const maxLeverage = this.config.rules.leverageCapsByJurisdiction[context.geoip.country];
            if (maxLeverage !== undefined && data.payload.leverage > maxLeverage) {
                evaluation.violations.push('leverage_exceeded');
                evaluation.score *= 0.3;
            }
        }

        // Market abuse pattern kontrolü
        if (context.marketPatterns && context.marketPatterns.severity === 'high') {
            if (this.config.rules.marketAbusePatterns.includes(context.marketPatterns.pattern)) {
                evaluation.violations.push('market_abuse_pattern');
                evaluation.score *= 0.0;
            }
        }

        // Data export consent kontrolü
        if (data.kind === 'data.export' && this.config.rules.dataExportRequiresConsent) {
            if (!context.consent || !context.consent.granted) {
                evaluation.violations.push('consent_required');
                evaluation.score *= 0.1;
            }
        }

        return evaluation;
    }

    makeDecision(evaluation) {
        const reasonCodes = [...evaluation.violations, ...evaluation.warnings];
        let decision = 'allow';
        let enforcement = {};

        if (evaluation.score === 0.0) {
            // Hard violations
            if (evaluation.violations.includes('sanctions_hit') || 
                evaluation.violations.includes('market_abuse_pattern') ||
                evaluation.violations.includes('restricted_symbol')) {
                decision = 'halt';
            } else {
                decision = 'block';
            }
        } else if (evaluation.score < 0.5) {
            decision = 'allow_with_limits';
            enforcement = {
                rateLimitPerMin: Math.max(1, Math.floor(this.config.enforcement.defaultRateLimitPerMin * evaluation.score)),
                positionLimitFactor: Math.max(0.1, this.config.enforcement.defaultPositionLimitFactor * evaluation.score),
                blockVariants: evaluation.warnings.includes('vpn_suspected') ? ['aggressive'] : []
            };
        } else if (evaluation.score < 1.0) {
            decision = 'allow_with_limits';
            enforcement = {
                rateLimitPerMin: this.config.enforcement.defaultRateLimitPerMin,
                positionLimitFactor: this.config.enforcement.defaultPositionLimitFactor
            };
        }

        // Override gereksinimi kontrolü
        if (this.requiresApproval(decision, reasonCodes)) {
            decision = 'needs_approval';
        }

        return {
            decision,
            reasonCodes,
            enforcement,
            score: evaluation.score,
            timestamp: new Date().toISOString(),
            ruleSetVersion: 'v7' // Mock version
        };
    }

    requiresApproval(decision, reasonCodes) {
        if (this.config.approvals.requireForDecisions.includes(decision)) {
            return true;
        }
        
        if (decision === 'allow_with_limits' && reasonCodes.includes('geo_restricted')) {
            return true;
        }
        
        if (reasonCodes.includes('blackout_window')) {
            return true;
        }
        
        return false;
    }

    async checkSanctions(actor) {
        if (!actor || !actor.operatorId) return null;
        
        // Cache kontrolü
        const cached = this.contextCache.sanctionsCache.get(actor.operatorId);
        if (cached && Date.now() - cached.timestamp < this.config.sanctions.cacheTtlSec * 1000) {
            return cached.data;
        }
        
        try {
            // Mock sanctions check
            const result = await this.performSanctionsCheck(actor);
            
            this.contextCache.sanctionsCache.set(actor.operatorId, {
                data: result,
                timestamp: Date.now()
            });
            
            return result;
        } catch (error) {
            this.logger.warn(`Sanctions check failed for ${actor.operatorId}: ${error.message}`);
            
            if (this.config.sanctions.failClosed) {
                await this.emitAlert('warn', 'sanctions_provider_down', { operatorId: actor.operatorId });
                return { confidence: 1.0, hit: true, provider: 'failsafe' }; // Fail closed
            }
            
            return null;
        }
    }

    async performSanctionsCheck(actor) {
        // Mock implementation - gerçekte OFAC/UN API'lerini çağırır
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(null); // No hit
            }, 50);
        });
    }

    isInBlackoutWindow(currentTime) {
        const now = new Date(currentTime);
        const timeString = now.toTimeString().substring(0, 5); // HH:MM format
        
        for (const window of this.config.rules.blackoutWindows) {
            const [start, end] = window.split('-');
            
            if (start <= end) {
                // Same day window
                if (timeString >= start && timeString <= end) {
                    return true;
                }
            } else {
                // Overnight window
                if (timeString >= start || timeString <= end) {
                    return true;
                }
            }
        }
        
        return false;
    }

    async appendToWorm(decision, data) {
        try {
            const wormEntry = {
                timestamp: decision.timestamp,
                ethicsKey: this.generateEthicsKey(data),
                actionId: data.actionId,
                decision: decision.decision,
                reasonCodes: decision.reasonCodes,
                actorHash: this.hashActor(data.actor),
                hash: null // Will be calculated
            };
            
            // Hash chain calculation
            const prevHash = this.hashChain.length > 0 
                ? this.hashChain[this.hashChain.length - 1].hash 
                : '0'.repeat(64);
            
            wormEntry.hash = this.calculateHash(prevHash, wormEntry);
            
            // Add to chain
            this.hashChain.push(wormEntry);
            
            // Persist to file (mock implementation)
            await this.persistWormEntry(wormEntry);
            
            this.logger.debug(`WORM entry added: ${wormEntry.hash.substring(0, 8)}...`);
        } catch (error) {
            this.logger.error(`WORM append failed: ${error.message}`);
            await this.emitAlert('error', 'worm_failure', { actionId: data.actionId });
        }
    }

    calculateHash(prevHash, entry) {
        const crypto = require('crypto');
        const data = `${prevHash}||${entry.timestamp}||${entry.ethicsKey}||${entry.decision}||${JSON.stringify(entry.reasonCodes)}||${entry.actorHash}`;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    hashActor(actor) {
        if (!actor) return 'anonymous';
        
        const crypto = require('crypto');
        const dailySalt = new Date().toISOString().split('T')[0]; // Daily rotating salt
        return crypto.createHash('sha256').update(`${actor.operatorId}:${dailySalt}`).digest('hex').substring(0, 16);
    }

    async emitEthicsEvents(decision, data) {
        if (!this.eventBus) return;

        const ethicsKey = this.generateEthicsKey(data);
        
        // Ana karar event'i
        this.eventBus.emit('ethics.gate.proposed', {
            event: 'ethics.gate.proposed',
            timestamp: decision.timestamp,
            ethicsKey,
            actionId: data.actionId,
            decision: decision.decision,
            reasonCodes: decision.reasonCodes,
            enforcement: decision.enforcement || {},
            audit: {
                ruleSetVersion: decision.ruleSetVersion,
                producedBy: this.name
            }
        });

        // Activation event
        if (['block', 'halt', 'allow_with_limits'].includes(decision.decision)) {
            this.eventBus.emit('ethics.gate.activated', {
                event: 'ethics.gate.activated',
                timestamp: decision.timestamp,
                ethicsKey,
                decision: decision.decision,
                effectiveFrom: decision.timestamp,
                effectiveUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min TTL
                hash: this.hashChain[this.hashChain.length - 1]?.hash || 'unknown'
            });
        }

        // Blocked action event
        if (['block', 'halt'].includes(decision.decision)) {
            this.eventBus.emit('ethics.blocked.action', {
                event: 'ethics.blocked.action',
                timestamp: decision.timestamp,
                actionId: data.actionId,
                reasonCodes: decision.reasonCodes,
                notify: ['compliance', 'policy']
            });
        }

        // UI kartı
        const card = this.createDecisionCard(decision, data);
        this.eventBus.emit('ethics.decision.card', card);

        // Override request if needed
        if (decision.decision === 'needs_approval') {
            this.eventBus.emit('ethics.override.request', {
                event: 'ethics.override.request',
                timestamp: decision.timestamp,
                ethicsKey,
                requestedBy: 'policy',
                scope: data.scope || 'global',
                ttlMin: 30,
                rationale: `Etik kontrol onayı: ${decision.reasonCodes.join(', ')}`
            });
        }

        // Metrikler
        await this.emitMetrics();
    }

    createDecisionCard(decision, data) {
        const reasonsText = this.formatReasonsText(decision.reasonCodes);
        const symbol = data.symbol || 'Global';
        
        let body = `Nedenler: ${reasonsText}`;
        if (decision.enforcement?.blockVariants?.length > 0) {
            body += ` • ${symbol} için ${decision.enforcement.blockVariants.join(', ')} kapalı`;
        }
        if (decision.enforcement?.positionLimitFactor) {
            body += `, posLimit ×${decision.enforcement.positionLimitFactor}`;
        }
        body += ' • TTL 30dk.';

        return {
            event: 'ethics.decision.card',
            timestamp: decision.timestamp,
            title: `Etik/Uyum Kararı — ${this.formatDecisionText(decision.decision)}`,
            body,
            severity: decision.decision === 'allow' ? 'info' : 'warn',
            ttlSec: 600
        };
    }

    formatReasonsText(reasonCodes) {
        const translations = {
            geo_restricted: 'geo kısıtı',
            vpn_suspected: 'vpn',
            blackout_window: 'blackout',
            sanctions_hit: 'yaptırım',
            market_abuse_pattern: 'market abuse',
            leverage_exceeded: 'kaldıraç',
            consent_required: 'onay gerekli'
        };
        
        return reasonCodes.map(code => translations[code] || code).join('+');
    }

    formatDecisionText(decision) {
        const translations = {
            allow: 'İzin Verildi',
            allow_with_limits: 'Sınırlı İzin',
            block: 'Engellendi',
            halt: 'Durduruldu',
            needs_approval: 'Onay Bekliyor'
        };
        
        return translations[decision] || decision;
    }

    async emitMetrics() {
        if (!this.eventBus) return;

        // Cache'den istatistikler çıkar
        const decisions = Array.from(this.ethicsStore.values()).map(v => v.result);
        const counts = {
            evaluated: decisions.length,
            blocked: decisions.filter(d => d.decision === 'block').length,
            halted: decisions.filter(d => d.decision === 'halt').length,
            needsApproval: decisions.filter(d => d.decision === 'needs_approval').length,
            allowedWithLimits: decisions.filter(d => d.decision === 'allow_with_limits').length
        };

        this.eventBus.emit('ethics.metrics', {
            event: 'ethics.metrics',
            timestamp: new Date().toISOString(),
            ...counts,
            avgEvalMs: 9.2, // Mock
            sanctionsChecks: this.contextCache.sanctionsCache.size,
            geoMismatches: decisions.filter(d => d.reasonCodes.includes('geo_restricted')).length,
            marketAbuseFlags: decisions.filter(d => d.reasonCodes.includes('market_abuse_pattern')).length,
            wormAppendFailures: 0,
            hashChainAlerts: 0
        });
    }

    async emitAlert(level, message, context = {}) {
        if (!this.eventBus) return;

        this.eventBus.emit('ethics.alert', {
            event: 'ethics.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        });
    }

    // Utility methods
    generateEthicsKey(data) {
        const actionId = data.actionId || 'unknown';
        const ruleSetVersion = 'v7';
        const scope = data.scope || 'global';
        const symbol = data.symbol || '';
        
        const crypto = require('crypto');
        const keyData = `${actionId}+${ruleSetVersion}+${scope}+${symbol}`;
        return crypto.createHash('sha256').update(keyData).digest('hex').substring(0, 16);
    }

    async initializeWormStorage() {
        // Mock WORM storage initialization
        this.logger.debug('WORM storage initialized');
    }

    async loadHashChain() {
        // Mock hash chain loading
        this.hashChain = [];
        this.logger.debug('Hash chain loaded');
    }

    async persistWormEntry(entry) {
        // Mock persistence
        return Promise.resolve();
    }

    performScheduledSweep() {
        this.logger.debug('Scheduled sweep: context cache cleanup...');
        
        // Cleanup expired cache entries
        const now = Date.now();
        const ttl = this.config.sanctions.cacheTtlSec * 1000;
        
        for (const [key, value] of this.contextCache.sanctionsCache.entries()) {
            if (now - value.timestamp > ttl) {
                this.contextCache.sanctionsCache.delete(key);
            }
        }
    }

    // Event Handlers
    handleActionIntent(data) {
        this.logger.debug(`Action intent alındı: ${data.actionId} (${data.kind})`);
        this.process(data);
    }

    handlePolicyChangeRequest(data) {
        this.logger.debug(`Policy change request: ${JSON.stringify(data.change)}`);
        this.process(data);
    }

    handleKycStatus(data) {
        this.contextCache.kycStatuses.set(data.operatorId, data);
        this.logger.debug(`KYC status güncellendi: ${data.operatorId} -> ${data.level}`);
    }

    handleAmlHit(data) {
        this.contextCache.amlHits.set(data.entity, data);
        this.logger.debug(`AML hit kaydedildi: ${data.entity} (${data.confidence})`);
    }

    handleGeoIpUpdate(data) {
        this.contextCache.geoIpData.set(data.operatorId, data);
        this.logger.debug(`GeoIP güncellendi: ${data.operatorId} -> ${data.country}`);
    }

    handleMarketPattern(data) {
        this.contextCache.marketPatterns.set(data.symbol, data);
        this.logger.debug(`Market pattern tespit edildi: ${data.symbol} -> ${data.pattern}`);
    }

    handleBlacklistUpdate(data) {
        // Update configuration with new blacklist
        if (data.restrictedSymbols) {
            this.config.rules.restrictedSymbols = data.restrictedSymbols;
        }
        if (data.blackoutWindows) {
            this.config.rules.blackoutWindows = data.blackoutWindows;
        }
        this.logger.info('Blacklist güncellendi');
    }

    handleConsentLog(data) {
        this.contextCache.consentLogs.set(data.operatorId, data);
        this.logger.debug(`Consent logged: ${data.operatorId} -> ${data.purpose}`);
    }

    handleApprovalGranted(data) {
        this.logger.info(`Ethics override onayı verildi: ${data.ethicsKey}`);
        // Override logic here
    }

    handleApprovalRejected(data) {
        this.logger.warn(`Ethics override reddedildi: ${data.ethicsKey}`);
        // Rejection handling here
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            evaluations: this.ethicsStore.size,
            hashChainLength: this.hashChain.length,
            cache: {
                kyc: this.contextCache.kycStatuses.size,
                aml: this.contextCache.amlHits.size,
                geoip: this.contextCache.geoIpData.size,
                sanctions: this.contextCache.sanctionsCache.size
            },
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            if (this.sweepInterval) {
                clearInterval(this.sweepInterval);
                this.sweepInterval = null;
            }
            
            this.ethicsStore.clear();
            this.hashChain = [];
            Object.values(this.contextCache).forEach(cache => cache.clear());
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = EthicsAndComplianceGate;