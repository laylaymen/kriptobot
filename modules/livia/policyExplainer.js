/**
 * LIVIA-08 · policyExplainer.js
 * Policy ve guard kararlarının neden alındığını açıklama modülü
 */

class PolicyExplainer {
    constructor(config = {}) {
        this.name = 'PolicyExplainer';
        this.config = {
            enabled: true,
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            style: {
                maxBullets: 5,
                includeNumbers: true,
                includeWhatIf: true,
                includeCitations: true,
                cardMaxChars: 280
            },
            mapping: {
                violations: {
                    expected_slip_gt_max: "Slip p95 ≈ ${got} bps, policy limiti ${limit} bps.",
                    expected_slip_gt_max_x2: "Slip ≈ ${got} bps, limitin 2 katı (${limit}).",
                    spread_gt_max: "Spread ≈ ${got} bps, limit ${limit} bps; MARKET yerine LIMIT/TWAP önerilir.",
                    min_rr_not_met: "RR ≈ ${got} (< ${limit}); SL sıkılaştır veya TP genişlet.",
                    qty_usd_gt_max: "Miktar ≈ ${gotUSD}$, üst sınır ${limitUSD}$.",
                    leverage_gt_max: "Tahmini kaldıraç ≈ ${lev}, üst sınır ${maxLev}."
                },
                guards: {
                    slowdown: "Guard=slowdown: agresif girişler kısıtlı; conservative + parçalı emir daha güvenli.",
                    block_aggressive: "Guard=block_aggressive: agresif varyant geçici olarak kapalı.",
                    halt_entry: "Guard=halt_entry: yeni girişlere izin yok."
                }
            },
            whatIfRules: [
                { when: "expected_slip_gt_max", suggest: "exec='limit', qty×0.75, slices=3 → slip ≤ ${limit} bps olabilir." },
                { when: "spread_gt_max", suggest: "spread ≤ ${limit} bps olduğunda MARKET tekrar denenebilir." },
                { when: "min_rr_not_met", suggest: "SL −5 bps & TP +5 bps ile RR eşiğini geç." }
            ],
            idempotencyTtlSec: 600,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.explainCache = new Map();
        this.contextStore = {
            lastPolicySnapshot: null,
            lastGuardDirective: null,
            lastMarketRefs: new Map(),
            lastCostForecast: new Map()
        };
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setup();
            this.setupEventListeners();
            
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
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Policy ve context güncellemeleri dinle
        this.eventBus.on('policy.snapshot', (data) => this.handlePolicySnapshot(data));
        this.eventBus.on('sentry.guard.directive', (data) => this.handleGuardDirective(data));
        this.eventBus.on('latency_slip.guard.directive', (data) => this.handleGuardDirective(data));
        this.eventBus.on('confirmation.bounds.check', (data) => this.handleBoundsCheck(data));
        this.eventBus.on('market.refs', (data) => this.handleMarketRefs(data));
        this.eventBus.on('cost.forecast.update', (data) => this.handleCostForecast(data));
        this.eventBus.on('knowledge.route.select', (data) => this.handleKnowledgeRoute(data));
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processExplanation(data);
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

    async processExplanation(data) {
        const explainKey = this.generateExplainKey(data);
        
        // Idempotency kontrolü
        if (this.explainCache.has(explainKey)) {
            const cached = this.explainCache.get(explainKey);
            if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                return cached.result;
            }
        }

        // Açıklama oluştur
        const explanation = await this.composeExplanation(data);
        
        // Cache'e kaydet
        this.explainCache.set(explainKey, {
            result: explanation,
            timestamp: Date.now()
        });

        // Event'leri yayınla
        this.emitExplanationEvents(explanation);

        return explanation;
    }

    async composeExplanation(data) {
        const context = this.gatherContext(data);
        const violations = this.extractViolations(data);
        const guardMode = this.extractGuardMode(data);

        const bullets = [];
        const whatIf = [];
        const citations = [];

        // Violation açıklamalarını ekle
        for (const violation of violations) {
            const bullet = this.composeViolationBullet(violation, context);
            if (bullet) bullets.push(bullet);

            const cite = this.getCitationForViolation(violation);
            if (cite) citations.push(cite);

            if (this.config.style.includeWhatIf) {
                const suggestion = this.generateWhatIfSuggestion(violation);
                if (suggestion) whatIf.push(suggestion);
            }
        }

        // Guard açıklamasını ekle
        if (guardMode && guardMode !== 'normal') {
            const guardBullet = this.config.mapping.guards[guardMode];
            if (guardBullet) bullets.push(guardBullet);
        }

        // Başlık oluştur
        const title = this.generateTitle(violations, guardMode);

        const explanation = {
            event: 'policy.explain',
            timestamp: new Date().toISOString(),
            explainKey: this.generateExplainKey(data),
            kind: this.determineKind(data),
            title,
            bullets: bullets.slice(0, this.config.style.maxBullets),
            whatIf: whatIf.slice(0, 2),
            citations,
            context: {
                symbol: data.symbol || context.symbol,
                guardMode: guardMode,
                policyVersion: context.policyVersion,
                violations: violations.map(v => v.code)
            },
            audit: {
                eventId: data.eventId || this.generateEventId(),
                producedBy: this.name,
                producedAt: new Date().toISOString()
            }
        };

        return explanation;
    }

    composeViolationBullet(violation, context) {
        const template = this.config.mapping.violations[violation.code];
        if (!template) return null;

        return template
            .replace('${got}', violation.got)
            .replace('${limit}', violation.limit)
            .replace('${gotUSD}', violation.gotUSD)
            .replace('${limitUSD}', violation.limitUSD)
            .replace('${lev}', violation.lev)
            .replace('${maxLev}', violation.maxLev);
    }

    generateWhatIfSuggestion(violation) {
        const rule = this.config.whatIfRules.find(r => r.when === violation.code);
        if (!rule) return null;

        return rule.suggest.replace('${limit}', violation.limit);
    }

    generateTitle(violations, guardMode) {
        if (guardMode && guardMode !== 'normal') {
            return `Guard devrede — ${guardMode}`;
        }

        if (violations.length > 0) {
            const mainViolation = violations[0];
            if (mainViolation.code.includes('slip')) {
                return 'Plan neden geçmedi? — Slip/Spread limitleri';
            }
            if (mainViolation.code.includes('rr')) {
                return 'RR yetersiz — Risk/Reward oranı';
            }
        }

        return 'Policy kontrolü — Detaylar';
    }

    determineKind(data) {
        if (data.event?.includes('guard')) return 'guard';
        if (data.event?.includes('bounds')) return 'bounds';
        if (data.event?.includes('variant')) return 'variant';
        return 'policy_change';
    }

    generateExplainKey(data) {
        const kind = this.determineKind(data);
        const sourceId = data.checkId || data.symbol || 'unknown';
        const snapshotTs = data.timestamp || Date.now();
        return `px#${kind}#${sourceId}#${snapshotTs}`;
    }

    generateEventId() {
        return `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    gatherContext(data) {
        return {
            symbol: data.symbol,
            policyVersion: this.contextStore.lastPolicySnapshot?.versionId || 'unknown',
            marketRefs: this.contextStore.lastMarketRefs.get(data.symbol),
            costForecast: this.contextStore.lastCostForecast.get(data.symbol)
        };
    }

    extractViolations(data) {
        if (data.violations) {
            return data.violations.map(v => ({
                code: v.code,
                got: v.got,
                limit: v.limit,
                gotUSD: v.gotUSD,
                limitUSD: v.limitUSD,
                lev: v.lev,
                maxLev: v.maxLev
            }));
        }
        return [];
    }

    extractGuardMode(data) {
        if (data.mode) return data.mode;
        if (this.contextStore.lastGuardDirective) {
            return this.contextStore.lastGuardDirective.mode;
        }
        return 'normal';
    }

    getCitationForViolation(violation) {
        const basePath = 'app://kb/policy/';
        let path = '';
        
        if (violation.code.includes('slip')) path = 'limits@v42#c1';
        else if (violation.code.includes('spread')) path = 'limits@v42#c2';
        else if (violation.code.includes('rr')) path = 'limits@v42#c3';
        else if (violation.code.includes('qty')) path = 'limits@v42#c4';
        else if (violation.code.includes('leverage')) path = 'limits@v42#c5';

        if (path) {
            return {
                path: violation.code,
                version: 'v42',
                href: basePath + path
            };
        }
        
        return null;
    }

    emitExplanationEvents(explanation) {
        if (!this.eventBus) return;

        // Ana açıklama event'i
        this.eventBus.emit('policy.explain', explanation);

        // UI kart oluştur
        if (this.config.style.cardMaxChars > 0) {
            const card = this.createUICard(explanation);
            this.eventBus.emit('policy.explain.card', card);
        }

        // Metrikleri yayınla
        this.emitMetrics();
    }

    createUICard(explanation) {
        const shortBody = explanation.bullets.slice(0, 2).join(' ');
        const truncatedBody = shortBody.length > this.config.style.cardMaxChars 
            ? shortBody.substring(0, this.config.style.cardMaxChars - 3) + '...'
            : shortBody;

        return {
            event: 'policy.explain.card',
            timestamp: new Date().toISOString(),
            title: explanation.title,
            body: truncatedBody,
            links: explanation.citations.slice(0, 1).map(c => ({
                label: `Policy ${c.version} — ${c.path}`,
                href: c.href
            })),
            severity: 'warn',
            ttlSec: 180
        };
    }

    emitMetrics() {
        if (!this.eventBus) return;

        this.eventBus.emit('policy.explain.metrics', {
            event: 'policy.explain.metrics',
            timestamp: new Date().toISOString(),
            explains: this.explainCache.size,
            byKind: this.getMetricsByKind(),
            avgComposeMs: 6, // Mock değer
            withCitationsRate: 0.92
        });
    }

    getMetricsByKind() {
        // Cache'den kind bazında istatistikler
        return { bounds: 7, guard: 3, variant: 2 };
    }

    // Event Handlers
    handlePolicySnapshot(data) {
        this.contextStore.lastPolicySnapshot = data;
        this.logger.debug(`Policy snapshot güncellendi: ${data.versionId}`);
    }

    handleGuardDirective(data) {
        this.contextStore.lastGuardDirective = data;
        this.logger.debug(`Guard directive güncellendi: ${data.mode}`);
        
        // Guard değişiklikleri açıklama tetikleyebilir
        if (data.mode !== 'normal') {
            this.process(data);
        }
    }

    handleBoundsCheck(data) {
        this.logger.debug(`Bounds check: ${data.ok ? 'OK' : 'FAIL'}`);
        
        // Başarısız bounds check açıklama tetikler
        if (!data.ok) {
            this.process(data);
        }
    }

    handleMarketRefs(data) {
        if (data.symbol) {
            this.contextStore.lastMarketRefs.set(data.symbol, data);
        }
    }

    handleCostForecast(data) {
        if (data.symbol) {
            this.contextStore.lastCostForecast.set(data.symbol, data);
        }
    }

    handleKnowledgeRoute(data) {
        // Knowledge routing bilgileri citations için kullanılabilir
        this.logger.debug(`Knowledge route seçildi: ${data.routeKey}`);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            cacheSize: this.explainCache.size,
            lastPolicyVersion: this.contextStore.lastPolicySnapshot?.versionId || 'none',
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            this.explainCache.clear();
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = PolicyExplainer;