/**
 * LIVIA-27: Secrets Leak Scanner
 * LIVIA ekosistemindeki tüm metin/diff/rapor/not/policy çıktılarında gizli anahtar/sır 
 * sızıntılarını tespit et, maskele ve dağıtımı engelle/karantinaya al.
 */

import { z } from 'zod';

// Giriş şemaları
const SecretScanRequestSchema = z.object({
    event: z.literal('secret.scan.request'),
    timestamp: z.string(),
    profileId: z.enum(['digest', 'postmortem', 'notes', 'policy', 'generic']),
    mode: z.enum(['markdown', 'html', 'text', 'diff']),
    content: z.string().nullable(),
    path: z.string().nullable(),
    source: z.object({
        event: z.string(),
        hash: z.string()
    }),
    options: z.object({
        severity: z.enum(['auto', 'low', 'medium', 'high']),
        blockOnHigh: z.boolean(),
        classify: z.boolean()
    })
}).strict();

const DistRequestSchema = z.object({
    event: z.literal('dist.request'),
    timestamp: z.string(),
    contentRef: z.object({
        type: z.enum(['digest', 'postmortem', 'notes', 'card', 'generic']),
        path: z.string(),
        format: z.enum(['md', 'html', 'text'])
    }),
    audience: z.array(z.enum(['ops', 'policy', 'observer'])),
    channels: z.array(z.enum(['ui', 'slack', 'webhook'])),
    priority: z.enum(['normal', 'high', 'urgent']),
    dryRun: z.boolean()
}).strict();

// Çıkış şemaları
const SecretScanReadySchema = z.object({
    event: z.literal('secret.scan.ready'),
    timestamp: z.string(),
    profileId: z.enum(['digest', 'postmortem', 'notes', 'policy', 'generic']),
    path: z.string(),
    classification: z.enum(['SAFE', 'SUSPICIOUS', 'LEAK']),
    findings: z.array(z.object({
        type: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
        masked: z.string(),
        line: z.number(),
        entropy: z.number(),
        expiresAt: z.string().optional()
    })),
    maskedContent: z.string().optional(),
    actions: z.array(z.enum(['block_distribution', 'quarantine', 'rotate', 'revoke', 'notify_compliance'])),
    hash: z.string()
}).strict();

const SecretQuarantineSchema = z.object({
    event: z.literal('secret.quarantine'),
    timestamp: z.string(),
    reason: z.enum(['LEAK', 'SUSPICIOUS']),
    path: z.string(),
    vaultRef: z.string()
}).strict();

const SecretRotateSuggestSchema = z.object({
    event: z.literal('secret.rotate.suggest'),
    timestamp: z.string(),
    kind: z.enum(['aws', 'gcp', 'azure', 'generic']),
    refHint: z.string(),
    urgency: z.enum(['high', 'medium', 'low'])
}).strict();

const SecretCardSchema = z.object({
    event: z.literal('secret.card'),
    timestamp: z.string(),
    title: z.string(),
    body: z.string(),
    severity: z.enum(['error', 'warn', 'info']),
    ttlSec: z.number()
}).strict();

const SecretMetricsSchema = z.object({
    event: z.literal('secret.metrics'),
    timestamp: z.string(),
    scans: z.number(),
    leaks: z.number(),
    suspicious: z.number(),
    safe: z.number(),
    blocked: z.number(),
    quarantined: z.number(),
    avgScanMs: z.number(),
    fpRate: z.number(),
    fnGuard: z.boolean()
}).strict();

type SecretScanRequest = z.infer<typeof SecretScanRequestSchema>;
type SecretScanReady = z.infer<typeof SecretScanReadySchema>;

/**
 * Secrets Leak Scanner - LIVIA-27
 * Gizli anahtar ve sır sızıntısı tespiti için ana sınıf
 */
class SecretsLeakScanner {
    private config: any;
    private logger: any;
    private isInitialized: boolean = false;
    private patterns: Map<string, RegExp> = new Map();
    private metrics = {
        scans: 0,
        leaks: 0,
        suspicious: 0,
        safe: 0,
        blocked: 0,
        quarantined: 0,
        totalScanTimeMs: 0
    };

    constructor(config: any = {}) {
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            profiles: {
                digest: { diffAware: false, maskInline: true },
                postmortem: { diffAware: true, maskInline: false },
                notes: { diffAware: true, maskInline: true },
                policy: { diffAware: true, maskInline: false },
                generic: { diffAware: true, maskInline: true }
            },
            patterns: {
                awsAccessKey: '\\bAKIA[0-9A-Z]{16}\\b',
                awsSecretKey: '(?i)aws_secret(?:_access)?_key\\s*[:=]\\s*([A-Za-z0-9/+=]{40})',
                gcpKeyJson: '"type":\\s*"service_account"',
                azureConn: 'Endpoint=sb:\\/\\/.*?;SharedAccessKeyName=.*?;SharedAccessKey=[A-Za-z0-9/+]{43}=',
                jwt: '\\beyJ[A-Za-z0-9_-]{10,}\\.([A-Za-z0-9_-]{10,})\\.[A-Za-z0-9_-]{10,}\\b',
                oauthClientSecret: '(?i)(client_secret|CLIENT_SECRET)\\s*[:=]\\s*[\'"][A-Za-z0-9_\\-]{12,}[\'"]',
                privateKey: '-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----[\\s\\S]+?-----END \\1 PRIVATE KEY-----',
                genericToken: '(?i)(api[-_ ]?key|token|secret)\\s*[:=]\\s*[\'"][A-Za-z0-9_\\-]{16,}[\'"]',
                envLeak: '(?m)^\\s*[A-Z0-9_]{3,32}\\s*=\\s*[^\\n]{6,}$'
            },
            validators: {
                entropyMinBitsPerChar: 3.0,
                maxScanTimeMs: 500,
                quarantineRetentionDays: 30
            },
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('LIVIA-27 SecretsLeakScanner başlatılıyor...');
            
            // Pattern'leri derle
            this.compilePatterns();
            
            this.isInitialized = true;
            this.logger.info('LIVIA-27 başarıyla başlatıldı');
            return true;
        } catch (error) {
            this.logger.error('LIVIA-27 başlatma hatası:', error);
            return false;
        }
    }

    /**
     * Secret tarama talep işleyicisi
     */
    async processSecretScanRequest(input: SecretScanRequest): Promise<SecretScanReady> {
        const validatedInput = SecretScanRequestSchema.parse(input);
        const startTime = Date.now();
        this.metrics.scans++;
        
        this.logger.info('Secret tarama başlıyor:', {
            profileId: validatedInput.profileId,
            mode: validatedInput.mode,
            hasContent: !!validatedInput.content,
            hasPath: !!validatedInput.path
        });

        // İçeriği al
        const content = await this.getContent(validatedInput);
        if (!content) {
            throw new Error('İçerik bulunamadı');
        }

        // Secret taraması yap
        const findings = await this.scanForSecrets(content, validatedInput.mode);
        
        // Sınıflandırma
        const classification = this.classifyFindings(findings);
        
        // Maskeleme
        const maskedContent = this.maskContent(content, findings, validatedInput.profileId);
        
        // Eylemler belirle
        const actions = this.determineActions(classification, findings);
        
        // Hash oluştur
        const hash = this.generateHash(content, findings);

        const scanTimeMs = Date.now() - startTime;
        this.metrics.totalScanTimeMs += scanTimeMs;
        this.updateMetrics(classification);

        // Yüksek seviye sızıntılarda blok
        if (classification === 'LEAK' && validatedInput.options.blockOnHigh) {
            await this.blockDistribution(validatedInput.source.hash);
        }

        // Karantina işlemi
        if (classification === 'LEAK' || classification === 'SUSPICIOUS') {
            await this.quarantineContent(validatedInput.path || 'unknown', content, classification);
        }

        const result: SecretScanReady = {
            event: 'secret.scan.ready',
            timestamp: new Date().toISOString(),
            profileId: validatedInput.profileId,
            path: validatedInput.path || 'inline-content',
            classification,
            findings,
            maskedContent: this.config.profiles[validatedInput.profileId].maskInline ? maskedContent : undefined,
            actions,
            hash
        };

        this.logger.info('Secret tarama tamamlandı:', {
            classification,
            findingsCount: findings.length,
            scanTimeMs
        });

        return SecretScanReadySchema.parse(result);
    }

    /**
     * İçeriği al (path veya inline)
     */
    private async getContent(request: SecretScanRequest): Promise<string | null> {
        if (request.content) {
            return request.content;
        }
        
        if (request.path) {
            // Simülasyon - gerçek implementasyonda dosya okuma
            this.logger.info('Dosya okunuyor:', request.path);
            return `# Sample content from ${request.path}\nAPI_KEY=sk-1234567890abcdef\nSECRET_TOKEN=very-secret-token-here`;
        }
        
        return null;
    }

    /**
     * Secret taraması yap
     */
    private async scanForSecrets(content: string, mode: string): Promise<any[]> {
        const findings: any[] = [];
        const lines = content.split('\n');
        
        for (const [patternName, pattern] of this.patterns) {
            const matches = content.matchAll(pattern);
            
            for (const match of matches) {
                const lineNumber = this.findLineNumber(content, match.index || 0);
                const matchedText = match[0];
                const entropy = this.calculateEntropy(matchedText);
                
                // Entropi kontrolü
                if (entropy < this.config.validators.entropyMinBitsPerChar) {
                    continue;
                }
                
                const severity = this.determineSeverity(patternName, entropy);
                const masked = this.maskSecret(matchedText, patternName);
                
                const finding: {
                    type: string;
                    severity: 'low' | 'medium' | 'high';
                    masked: string;
                    line: number;
                    entropy: number;
                    expiresAt?: string;
                } = {
                    type: this.getSecretType(patternName),
                    severity,
                    masked,
                    line: lineNumber,
                    entropy: Math.round(entropy * 100) / 100
                };
                
                // JWT için expiry kontrolü
                if (patternName === 'jwt') {
                    const expiresAt = this.extractJwtExpiry(matchedText);
                    if (expiresAt) {
                        finding.expiresAt = expiresAt;
                    }
                }
                
                findings.push(finding);
            }
        }
        
        return findings;
    }

    /**
     * Pattern'leri derle
     */
    private compilePatterns(): void {
        for (const [name, patternStr] of Object.entries(this.config.patterns)) {
            try {
                if (typeof patternStr === 'string') {
                    this.patterns.set(name, new RegExp(patternStr, 'g'));
                } else {
                    this.patterns.set(name, patternStr as RegExp);
                }
            } catch (error) {
                this.logger.warn(`Pattern derlenemedi [${name}]:`, error);
            }
        }
        
        this.logger.info(`${this.patterns.size} pattern derlendi`);
    }

    /**
     * Entropi hesapla
     */
    private calculateEntropy(text: string): number {
        const charCount = new Map<string, number>();
        
        for (const char of text) {
            charCount.set(char, (charCount.get(char) || 0) + 1);
        }
        
        let entropy = 0;
        const length = text.length;
        
        for (const count of charCount.values()) {
            const probability = count / length;
            entropy -= probability * Math.log2(probability);
        }
        
        return entropy;
    }

    /**
     * Severity belirle
     */
    private determineSeverity(patternName: string, entropy: number): 'low' | 'medium' | 'high' {
        // Yüksek entropi + kritik pattern = high
        if (entropy > 4.5 && ['awsAccessKey', 'awsSecretKey', 'privateKey'].includes(patternName)) {
            return 'high';
        }
        
        // Orta seviye
        if (entropy > 3.5 || ['jwt', 'oauthClientSecret'].includes(patternName)) {
            return 'medium';
        }
        
        return 'low';
    }

    /**
     * Secret'ı maskele
     */
    private maskSecret(text: string, patternName: string): string {
        if (text.length <= 8) {
            return '***';
        }
        
        const start = text.substring(0, 4);
        const end = text.substring(text.length - 2);
        const middle = '*'.repeat(Math.min(text.length - 6, 6));
        
        return `${start}${middle}${end}`;
    }

    /**
     * Secret tipi belirle
     */
    private getSecretType(patternName: string): string {
        const typeMap: Record<string, string> = {
            awsAccessKey: 'AWS_ACCESS_KEY',
            awsSecretKey: 'AWS_SECRET_KEY',
            gcpKeyJson: 'GCP_SERVICE_ACCOUNT',
            azureConn: 'AZURE_CONNECTION_STRING',
            jwt: 'JWT',
            oauthClientSecret: 'OAUTH_CLIENT_SECRET',
            privateKey: 'PRIVATE_KEY',
            genericToken: 'GENERIC_TOKEN',
            envLeak: 'ENV_VARIABLE'
        };
        
        return typeMap[patternName] || 'UNKNOWN';
    }

    /**
     * Satır numarasını bul
     */
    private findLineNumber(content: string, index: number): number {
        const beforeMatch = content.substring(0, index);
        return beforeMatch.split('\n').length;
    }

    /**
     * JWT expiry çıkar
     */
    private extractJwtExpiry(jwt: string): string | null {
        try {
            const parts = jwt.split('.');
            if (parts.length !== 3) return null;
            
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload.exp) {
                return new Date(payload.exp * 1000).toISOString();
            }
        } catch {
            // JWT parse hatası, ignore
        }
        
        return null;
    }

    /**
     * Bulgular sınıflandır
     */
    private classifyFindings(findings: any[]): 'SAFE' | 'SUSPICIOUS' | 'LEAK' {
        if (findings.length === 0) return 'SAFE';
        
        const hasHigh = findings.some(f => f.severity === 'high');
        if (hasHigh) return 'LEAK';
        
        const hasMedium = findings.some(f => f.severity === 'medium');
        if (hasMedium) return 'SUSPICIOUS';
        
        return 'SUSPICIOUS'; // Low severity bile şüpheli sayılıyor
    }

    /**
     * İçeriği maskele
     */
    private maskContent(content: string, findings: any[], profileId: string): string {
        let maskedContent = content;
        
        // Findings'leri ters sırada işle (index kaymalarını önlemek için)
        const sortedFindings = [...findings].sort((a, b) => b.line - a.line);
        
        for (const finding of sortedFindings) {
            // Basit maskeleme - gerçek implementasyonda daha sofistike olacak
            maskedContent = maskedContent.replace(
                new RegExp(finding.masked.replace(/\*/g, '\\*'), 'g'),
                '***MASKED***'
            );
        }
        
        return maskedContent;
    }

    /**
     * Eylemleri belirle
     */
    private determineActions(classification: string, findings: any[]): ('block_distribution' | 'quarantine' | 'rotate' | 'revoke' | 'notify_compliance')[] {
        const actions: ('block_distribution' | 'quarantine' | 'rotate' | 'revoke' | 'notify_compliance')[] = [];
        
        if (classification === 'LEAK') {
            actions.push('block_distribution', 'quarantine', 'notify_compliance');
            
            // Rotasyon önerileri
            const hasAws = findings.some(f => f.type.includes('AWS'));
            const hasGcp = findings.some(f => f.type.includes('GCP'));
            const hasAzure = findings.some(f => f.type.includes('AZURE'));
            
            if (hasAws || hasGcp || hasAzure) {
                actions.push('rotate');
            }
            
            // Critical keys için revoke
            const hasCritical = findings.some(f => f.severity === 'high');
            if (hasCritical) {
                actions.push('revoke');
            }
        } else if (classification === 'SUSPICIOUS') {
            actions.push('quarantine');
        }
        
        return actions;
    }

    /**
     * Hash oluştur
     */
    private generateHash(content: string, findings: any[]): string {
        const hashInput = content + JSON.stringify(findings);
        return `sha256:${Buffer.from(hashInput).toString('base64').slice(0, 16)}`;
    }

    /**
     * Dağıtımı blokla
     */
    private async blockDistribution(deliveryKey: string): Promise<void> {
        this.metrics.blocked++;
        this.logger.warn('Dağıtım bloklandı:', deliveryKey);
        
        // LIVIA-22'ye blok sinyali gönder (simülasyon)
        // await this.eventBus.emit('secret.block.distribution', { deliveryKey, reason: 'LEAK' });
    }

    /**
     * İçeriği karantinaya al
     */
    private async quarantineContent(path: string, content: string, reason: string): Promise<void> {
        this.metrics.quarantined++;
        
        const vaultRef = `state/quarantine/${new Date().toISOString().split('T')[0]}/${this.generateHash(content, [])}.json`;
        
        this.logger.warn('İçerik karantinaya alındı:', { path, vaultRef, reason });
        
        // Karantina eventi
        const quarantineEvent = {
            event: 'secret.quarantine',
            timestamp: new Date().toISOString(),
            reason,
            path,
            vaultRef
        };
        
        // Event emit (simülasyon)
        // await this.eventBus.emit('secret.quarantine', quarantineEvent);
    }

    /**
     * Metrikleri güncelle
     */
    private updateMetrics(classification: string): void {
        switch (classification) {
            case 'SAFE':
                this.metrics.safe++;
                break;
            case 'SUSPICIOUS':
                this.metrics.suspicious++;
                break;
            case 'LEAK':
                this.metrics.leaks++;
                break;
        }
    }

    /**
     * Rotasyon önerisi oluştur
     */
    generateRotateSuggestion(findings: any[]): any | null {
        const awsFindings = findings.filter(f => f.type.includes('AWS'));
        const gcpFindings = findings.filter(f => f.type.includes('GCP'));
        const azureFindings = findings.filter(f => f.type.includes('AZURE'));
        
        if (awsFindings.length > 0) {
            return SecretRotateSuggestSchema.parse({
                event: 'secret.rotate.suggest',
                timestamp: new Date().toISOString(),
                kind: 'aws',
                refHint: 'aws/iam/access-keys',
                urgency: awsFindings.some(f => f.severity === 'high') ? 'high' : 'medium'
            });
        }
        
        if (gcpFindings.length > 0) {
            return SecretRotateSuggestSchema.parse({
                event: 'secret.rotate.suggest',
                timestamp: new Date().toISOString(),
                kind: 'gcp',
                refHint: 'gcp/service-accounts',
                urgency: 'medium'
            });
        }
        
        return null;
    }

    /**
     * Kart eventi oluştur
     */
    generateSecretCard(classification: string, findings: any[]): any {
        const severity = classification === 'LEAK' ? 'error' : 
                        classification === 'SUSPICIOUS' ? 'warn' : 'info';
        
        let title = 'Secret Tarama Sonucu';
        if (classification === 'LEAK') title = 'Gizli Anahtar Sızıntısı Engellendi';
        if (classification === 'SUSPICIOUS') title = 'Şüpheli İçerik Tespit Edildi';
        
        const body = this.formatSecretCardBody(findings, classification);
        
        const card = {
            event: 'secret.card',
            timestamp: new Date().toISOString(),
            title,
            body,
            severity,
            ttlSec: classification === 'LEAK' ? 900 : 300
        };
        
        return SecretCardSchema.parse(card);
    }

    /**
     * Kart mesajını formatla
     */
    private formatSecretCardBody(findings: any[], classification: string): string {
        if (findings.length === 0) {
            return 'İçerik temiz, secret sızıntısı tespit edilmedi';
        }
        
        const types = [...new Set(findings.map(f => f.type))];
        const highCount = findings.filter(f => f.severity === 'high').length;
        
        let body = types.slice(0, 3).join(' & ') + ' bulguları';
        
        if (classification === 'LEAK') {
            body += ' • dağıtım durduruldu';
            if (highCount > 0) body += ' • rotasyon önerildi';
        }
        
        return body;
    }

    /**
     * Metrikleri getir
     */
    getMetrics(): any {
        const avgScanMs = this.metrics.scans > 0 ? 
            this.metrics.totalScanTimeMs / this.metrics.scans : 0;
        
        const metrics = {
            event: 'secret.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics,
            avgScanMs: Math.round(avgScanMs * 100) / 100,
            fpRate: 0.01, // Simülasyon
            fnGuard: true
        };
        
        delete (metrics as any).totalScanTimeMs; // Internal metric
        
        return SecretMetricsSchema.parse(metrics);
    }

    /**
     * Modül durumunu al
     */
    getStatus() {
        return {
            name: 'LIVIA-27',
            initialized: this.isInitialized,
            config: this.config,
            patterns: this.patterns.size,
            metrics: this.metrics
        };
    }
}

export default SecretsLeakScanner;
export {
    SecretsLeakScanner,
    SecretScanRequestSchema,
    DistRequestSchema,
    SecretScanReadySchema,
    SecretQuarantineSchema,
    SecretRotateSuggestSchema,
    SecretCardSchema,
    SecretMetricsSchema
};