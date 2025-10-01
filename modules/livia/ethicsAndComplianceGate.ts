/**
 * LIVIA-26: Ethics and Compliance Gate
 * İşlem/karar/ileti içeren tüm kritik eylemleri etik & uyum kurallarına göre 
 * ön denetime tabi tutmak; riskli/uygunsuz durumlarda otomatik blok/slowdown/halt uygulamak.
 */

import { z } from 'zod';

// Giriş şemaları
const ActionIntentSchema = z.object({
    event: z.literal('action.intent'),
    timestamp: z.string(),
    actionId: z.string(),
    kind: z.enum(['order.place', 'order.cancel', 'policy.change', 'data.export', 'note.publish']),
    scope: z.enum(['global', 'desk', 'symbol']),
    symbol: z.string().nullable(),
    payload: z.record(z.any()),
    actor: z.object({
        operatorId: z.string(),
        role: z.enum(['ops', 'policy', 'compliance', 'observer'])
    }),
    origin: z.object({
        ip: z.string(),
        geo: z.string(),
        tz: z.string()
    })
}).strict();

const KycStatusSchema = z.object({
    event: z.literal('kyc.status'),
    timestamp: z.string(),
    operatorId: z.string(),
    level: z.enum(['passed', 'pending', 'failed']),
    pep: z.boolean()
}).strict();

const AmlHitSchema = z.object({
    event: z.literal('aml.hit'),
    timestamp: z.string(),
    kind: z.enum(['sanctions', 'pep', 'adverse_media']),
    list: z.string(),
    entity: z.string(),
    confidence: z.number()
}).strict();

const GeolpUpdateSchema = z.object({
    event: z.literal('geoip.update'),
    timestamp: z.string(),
    operatorId: z.string(),
    ip: z.string(),
    country: z.string(),
    vpn_suspected: z.boolean()
}).strict();

const MarketPatternDetectedSchema = z.object({
    event: z.literal('market.pattern.detected'),
    timestamp: z.string(),
    pattern: z.enum(['spoofing', 'layering', 'wash_trade']),
    symbol: z.string(),
    severity: z.enum(['medium', 'high']),
    windowSec: z.number(),
    evidenceRef: z.string()
}).strict();

// Çıkış şemaları
const EthicsGateProposedSchema = z.object({
    event: z.literal('ethics.gate.proposed'),
    timestamp: z.string(),
    ethicsKey: z.string(),
    actionId: z.string(),
    decision: z.enum(['allow', 'allow_with_limits', 'block', 'halt', 'needs_approval']),
    reasonCodes: z.array(z.string()),
    enforcement: z.object({
        rateLimitPerMin: z.number().optional(),
        positionLimitFactor: z.number().optional(),
        blockVariants: z.array(z.string()).optional()
    }).optional(),
    audit: z.object({
        ruleSetVersion: z.string(),
        producedBy: z.literal('LIVIA-26')
    })
}).strict();

const EthicsGateActivatedSchema = z.object({
    event: z.literal('ethics.gate.activated'),
    timestamp: z.string(),
    ethicsKey: z.string(),
    decision: z.enum(['block', 'halt', 'allow_with_limits']),
    effectiveFrom: z.string(),
    effectiveUntil: z.string(),
    hash: z.string()
}).strict();

const EthicsBlockedActionSchema = z.object({
    event: z.literal('ethics.blocked.action'),
    timestamp: z.string(),
    actionId: z.string(),
    reasonCodes: z.array(z.string()),
    notify: z.array(z.string())
}).strict();

const EthicsDecisionCardSchema = z.object({
    event: z.literal('ethics.decision.card'),
    timestamp: z.string(),
    title: z.string(),
    body: z.string(),
    severity: z.enum(['warn', 'error', 'info']),
    ttlSec: z.number()
}).strict();

const EthicsMetricsSchema = z.object({
    event: z.literal('ethics.metrics'),
    timestamp: z.string(),
    evaluated: z.number(),
    blocked: z.number(),
    halted: z.number(),
    needsApproval: z.number(),
    allowedWithLimits: z.number(),
    avgEvalMs: z.number(),
    sanctionsChecks: z.number(),
    geoMismatches: z.number(),
    marketAbuseFlags: z.number()
}).strict();

type ActionIntent = z.infer<typeof ActionIntentSchema>;
type EthicsGateProposed = z.infer<typeof EthicsGateProposedSchema>;

/**
 * Ethics and Compliance Gate - LIVIA-26
 * Etik ve uyum kuralları denetimi için ana sınıf
 */
class EthicsAndComplianceGate {
    private config: any;
    private logger: any;
    private isInitialized: boolean = false;
    private kycCache: Map<string, any> = new Map();
    private geoCache: Map<string, any> = new Map();
    private sanctionsCache: Map<string, any> = new Map();
    private metrics = {
        evaluated: 0,
        blocked: 0,
        halted: 0,
        needsApproval: 0,
        allowedWithLimits: 0,
        sanctionsChecks: 0,
        geoMismatches: 0,
        marketAbuseFlags: 0
    };

    constructor(config: any = {}) {
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            rules: {
                geoRestrictedCountries: ['US', 'IR', 'KP', 'SY', 'CU', 'RU'],
                requireKycLevel: 'passed',
                vpnBlocked: true,
                blackoutWindows: ['22:00-07:00'],
                restrictedSymbols: ['XYZUSDT'],
                leverageCapsByJurisdiction: { 'DE': 2, 'TR': 5, 'US': 0 },
                marketAbusePatterns: ['spoofing', 'layering', 'wash_trade'],
                dataRetentionDays: 2555, // 7 yıl
                wormComplianceRequired: true
            },
            enforcement: {
                sanctionsTimeout: 5000,
                geoCheckTimeout: 2000,
                defaultRateLimitPerMin: 10,
                defaultPositionLimitFactor: 0.5
            },
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('LIVIA-26 EthicsAndComplianceGate başlatılıyor...');
            
            // Sanction listeleri ve geo veritabanını yükle
            await this.loadSanctionsLists();
            await this.loadGeoDatabase();
            
            this.isInitialized = true;
            this.logger.info('LIVIA-26 başarıyla başlatıldı');
            return true;
        } catch (error) {
            this.logger.error('LIVIA-26 başlatma hatası:', error);
            return false;
        }
    }

    /**
     * Eylem talebi işleyicisi - ana etik değerlendirme
     */
    async processActionIntent(input: ActionIntent): Promise<EthicsGateProposed> {
        const validatedInput = ActionIntentSchema.parse(input);
        this.metrics.evaluated++;
        
        this.logger.info('Etik değerlendirme başlıyor:', {
            actionId: validatedInput.actionId,
            kind: validatedInput.kind,
            actor: validatedInput.actor.operatorId
        });

        const ethicsKey = this.generateEthicsKey(validatedInput);
        const reasonCodes: string[] = [];
        let decision: 'allow' | 'allow_with_limits' | 'block' | 'halt' | 'needs_approval' = 'allow';
        let enforcement: any = {};

        // 1. KYC kontrolü
        const kycCheck = await this.checkKyc(validatedInput.actor.operatorId);
        if (!kycCheck.passed) {
            reasonCodes.push('kyc_failed');
            decision = 'block';
        }

        // 2. Coğrafi kısıtlama kontrolü
        const geoCheck = await this.checkGeoRestrictions(validatedInput.origin);
        if (!geoCheck.allowed) {
            reasonCodes.push(...geoCheck.reasonCodes);
            decision = 'block';
        }

        // 3. Sanctions kontrolü
        const sanctionsCheck = await this.checkSanctions(validatedInput.actor.operatorId);
        if (sanctionsCheck.hit) {
            reasonCodes.push('sanctions_hit');
            decision = 'halt';
            this.metrics.sanctionsChecks++;
        }

        // 4. VPN kontrolü
        if (this.config.rules.vpnBlocked && validatedInput.origin.ip) {
            const vpnCheck = await this.checkVpn(validatedInput.origin.ip);
            if (vpnCheck.suspected) {
                reasonCodes.push('vpn_suspected');
                if (decision === 'allow') decision = 'allow_with_limits';
                enforcement.rateLimitPerMin = 1;
            }
        }

        // 5. Blackout penceresi kontrolü
        const blackoutCheck = this.checkBlackoutWindow();
        if (!blackoutCheck.allowed) {
            reasonCodes.push('blackout_window');
            if (decision === 'allow') decision = 'allow_with_limits';
            enforcement.blockVariants = ['aggressive'];
        }

        // 6. Sembol kısıtlamaları
        if (validatedInput.symbol && this.config.rules.restrictedSymbols.includes(validatedInput.symbol)) {
            reasonCodes.push('restricted_symbol');
            decision = 'block';
        }

        // 7. Leverage kontrolü
        if (validatedInput.payload.leverage && validatedInput.origin.geo) {
            const leverageCheck = this.checkLeverageLimits(
                validatedInput.payload.leverage,
                validatedInput.origin.geo
            );
            if (!leverageCheck.allowed) {
                reasonCodes.push('leverage_exceeded');
                if (decision === 'allow') decision = 'allow_with_limits';
                enforcement.positionLimitFactor = 0.5;
            }
        }

        // 8. Market abuse pattern kontrolü
        const abuseCheck = await this.checkMarketAbuse(validatedInput);
        if (abuseCheck.detected) {
            reasonCodes.push('market_abuse');
            decision = 'needs_approval';
            this.metrics.marketAbuseFlags++;
        }

        // Metrikleri güncelle
        this.updateMetrics(decision);

        const result: EthicsGateProposed = {
            event: 'ethics.gate.proposed',
            timestamp: new Date().toISOString(),
            ethicsKey,
            actionId: validatedInput.actionId,
            decision,
            reasonCodes,
            enforcement: Object.keys(enforcement).length > 0 ? enforcement : undefined,
            audit: {
                ruleSetVersion: 'v7',
                producedBy: 'LIVIA-26'
            }
        };

        this.logger.info('Etik değerlendirme tamamlandı:', {
            actionId: validatedInput.actionId,
            decision,
            reasonCodes
        });

        return EthicsGateProposedSchema.parse(result);
    }

    /**
     * KYC kontrolü
     */
    private async checkKyc(operatorId: string): Promise<{ passed: boolean; level?: string }> {
        // Cache kontrolü
        if (this.kycCache.has(operatorId)) {
            return this.kycCache.get(operatorId);
        }

        // Simülasyon - gerçek implementasyonda KYC API çağrısı
        const kycLevel = Math.random() > 0.1 ? 'passed' : 'pending';
        const result = {
            passed: kycLevel === this.config.rules.requireKycLevel,
            level: kycLevel
        };

        this.kycCache.set(operatorId, result);
        return result;
    }

    /**
     * Coğrafi kısıtlama kontrolü
     */
    private async checkGeoRestrictions(origin: any): Promise<{ allowed: boolean; reasonCodes: string[] }> {
        const reasonCodes: string[] = [];
        
        if (this.config.rules.geoRestrictedCountries.includes(origin.geo)) {
            reasonCodes.push('geo_restricted');
            this.metrics.geoMismatches++;
        }

        return {
            allowed: reasonCodes.length === 0,
            reasonCodes
        };
    }

    /**
     * Sanctions kontrolü
     */
    private async checkSanctions(operatorId: string): Promise<{ hit: boolean; details?: any }> {
        // Cache kontrolü
        if (this.sanctionsCache.has(operatorId)) {
            return this.sanctionsCache.get(operatorId);
        }

        // Simülasyon - gerçek implementasyonda OFAC/EU sanctions API
        const hit = Math.random() < 0.01; // %1 hit oranı
        const result = { hit, details: hit ? { list: 'OFAC', confidence: 0.95 } : null };

        this.sanctionsCache.set(operatorId, result);
        return result;
    }

    /**
     * VPN kontrolü
     */
    private async checkVpn(ip: string): Promise<{ suspected: boolean }> {
        // Simülasyon - gerçek implementasyonda VPN detection API
        const suspected = Math.random() < 0.05; // %5 VPN oranı
        return { suspected };
    }

    /**
     * Blackout penceresi kontrolü
     */
    private checkBlackoutWindow(): { allowed: boolean } {
        const now = new Date();
        const hour = now.getHours();
        
        // 22:00-07:00 blackout
        const inBlackout = hour >= 22 || hour < 7;
        
        return { allowed: !inBlackout };
    }

    /**
     * Leverage limiti kontrolü
     */
    private checkLeverageLimits(leverage: number, geo: string): { allowed: boolean } {
        const maxLeverage = this.config.rules.leverageCapsByJurisdiction[geo] || 1;
        return { allowed: leverage <= maxLeverage };
    }

    /**
     * Market abuse pattern kontrolü
     */
    private async checkMarketAbuse(action: ActionIntent): Promise<{ detected: boolean; pattern?: string }> {
        // Simülasyon - gerçek implementasyonda pattern detection
        if (action.kind === 'order.place' && action.payload.qty > 1000) {
            const detected = Math.random() < 0.02; // %2 detection rate
            return {
                detected,
                pattern: detected ? 'large_order_pattern' : undefined
            };
        }
        
        return { detected: false };
    }

    /**
     * Ethics key oluştur (idempotency için)
     */
    private generateEthicsKey(action: ActionIntent): string {
        const keyComponents = [
            action.actionId,
            action.kind,
            action.scope,
            action.symbol || 'global',
            action.actor.operatorId,
            'v7' // ruleSetVersion
        ];
        
        return `ethics-${Buffer.from(keyComponents.join('|')).toString('base64').slice(0, 16)}`;
    }

    /**
     * Metrikleri güncelle
     */
    private updateMetrics(decision: string): void {
        switch (decision) {
            case 'block':
                this.metrics.blocked++;
                break;
            case 'halt':
                this.metrics.halted++;
                break;
            case 'needs_approval':
                this.metrics.needsApproval++;
                break;
            case 'allow_with_limits':
                this.metrics.allowedWithLimits++;
                break;
        }
    }

    /**
     * Sanctions listelerini yükle
     */
    private async loadSanctionsLists(): Promise<void> {
        this.logger.info('Sanctions listeleri yükleniyor...');
        // Simüle edilmiş yükleme
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    /**
     * Geo veritabanını yükle
     */
    private async loadGeoDatabase(): Promise<void> {
        this.logger.info('Geo veritabanı yükleniyor...');
        // Simüle edilmiş yükleme
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    /**
     * Karar kartı oluştur
     */
    generateDecisionCard(decision: EthicsGateProposed): any {
        const severity = decision.decision === 'allow' ? 'info' : 
                        decision.decision === 'block' || decision.decision === 'halt' ? 'error' : 'warn';
        
        const card = {
            event: 'ethics.decision.card',
            timestamp: new Date().toISOString(),
            title: `Etik/Uyum Kararı — ${decision.decision}`,
            body: this.formatDecisionBody(decision),
            severity,
            ttlSec: decision.decision === 'allow' ? 60 : 600
        };
        
        return EthicsDecisionCardSchema.parse(card);
    }

    /**
     * Karar mesajını formatla
     */
    private formatDecisionBody(decision: EthicsGateProposed): string {
        if (decision.reasonCodes.length === 0) {
            return 'Etik/uyum kontrolü: onaylandı';
        }
        
        const reasons = decision.reasonCodes.join(', ');
        let body = `Nedenler: ${reasons}`;
        
        if (decision.enforcement) {
            const limits = [];
            if (decision.enforcement.rateLimitPerMin) {
                limits.push(`rate: ${decision.enforcement.rateLimitPerMin}/dk`);
            }
            if (decision.enforcement.positionLimitFactor) {
                limits.push(`posLimit: ×${decision.enforcement.positionLimitFactor}`);
            }
            if (decision.enforcement.blockVariants) {
                limits.push(`bloklu: ${decision.enforcement.blockVariants.join(',')}`);
            }
            
            if (limits.length > 0) {
                body += ` • ${limits.join(', ')}`;
            }
        }
        
        return body;
    }

    /**
     * Metrikleri getir
     */
    getMetrics(): any {
        const metrics = {
            event: 'ethics.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics,
            avgEvalMs: 9.2 // Simülasyon
        };
        
        return EthicsMetricsSchema.parse(metrics);
    }

    /**
     * Modül durumunu al
     */
    getStatus() {
        return {
            name: 'LIVIA-26',
            initialized: this.isInitialized,
            config: this.config,
            cacheSize: {
                kyc: this.kycCache.size,
                geo: this.geoCache.size,
                sanctions: this.sanctionsCache.size
            },
            metrics: this.metrics
        };
    }
}

export default EthicsAndComplianceGate;
export {
    EthicsAndComplianceGate,
    ActionIntentSchema,
    KycStatusSchema,
    AmlHitSchema,
    GeolpUpdateSchema,
    MarketPatternDetectedSchema,
    EthicsGateProposedSchema,
    EthicsGateActivatedSchema,
    EthicsBlockedActionSchema,
    EthicsDecisionCardSchema,
    EthicsMetricsSchema
};