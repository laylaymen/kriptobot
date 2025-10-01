/**
 * LIVIA-27 · secretsLeakScanner.js
 * Gizli anahtar ve sır sızıntısı tespit ve engelleme modülü
 */

class SecretsLeakScanner {
    constructor(config = {}) {
        this.name = 'SecretsLeakScanner';
        this.config = {
            enabled: true,
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
                jwtValidateHeader: true,
                keyChecksumHeuristics: true
            },
            policy: {
                blockOn: ['LEAK'],
                quarantineOn: ['LEAK'],
                notify: ['ops', 'policy', 'compliance']
            },
            redaction: {
                profile: 'generic',
                maskStyle: 'partial'
            },
            idempotencyTtlSec: 86400,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.scanStore = new Map();
        this.compiledPatterns = new Map();
        this.quarantineVault = new Map();
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setup();
            this.setupEventListeners();
            this.compilePatterns();
            
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
            await this.initializeQuarantineVault();
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Tarama tetikleyicileri
        this.eventBus.on('secret.scan.request', (data) => this.handleScanRequest(data));
        this.eventBus.on('dist.request', (data) => this.handleDistributionRequest(data));
        this.eventBus.on('policy.diff.ready', (data) => this.handlePolicyDiff(data));
        this.eventBus.on('notes.daily.ready', (data) => this.handleNotesReady(data));
        this.eventBus.on('digest.daily.ready', (data) => this.handleDigestReady(data));
        this.eventBus.on('postmortem.ready', (data) => this.handlePostmortemReady(data));
    }

    compilePatterns() {
        this.logger.debug('Gizli anahtar kalıpları derleniyor...');
        
        for (const [name, pattern] of Object.entries(this.config.patterns)) {
            try {
                this.compiledPatterns.set(name, new RegExp(pattern, 'g'));
            } catch (error) {
                this.logger.warn(`Pattern compilation failed for ${name}: ${error.message}`);
            }
        }
        
        this.logger.debug(`${this.compiledPatterns.size} kalıp derlendi`);
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processSecretScan(data);
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

    async processSecretScan(data) {
        const scanKey = this.generateScanKey(data);
        
        // Idempotency kontrolü
        if (this.scanStore.has(scanKey)) {
            const cached = this.scanStore.get(scanKey);
            if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                return cached.result;
            }
        }

        // Tarama işlemi
        const result = await this.performScan(data);
        
        // Cache'e kaydet
        this.scanStore.set(scanKey, {
            result,
            timestamp: Date.now()
        });

        return result;
    }

    async performScan(data) {
        this.logger.debug(`Gizli anahtar taraması başlatılıyor: ${data.profileId || 'generic'}`);
        
        const startTime = Date.now();
        
        // İçeriği al
        const content = await this.getContent(data);
        if (!content) {
            throw new Error('Content not available for scanning');
        }

        // Mode'a göre parse et
        const parsedContent = this.parseContent(content, data.mode || 'text');
        
        // Diff aware ise sadece eklenen satırları tara
        const targetContent = this.filterContent(parsedContent, data);
        
        // Pattern detection (Pass-1)
        const detections = this.detectPatterns(targetContent);
        
        // Validation (Pass-2)
        const validatedFindings = await this.validateFindings(detections, targetContent);
        
        // Classification
        const classification = this.classifyFindings(validatedFindings);
        
        // Masking
        const maskedContent = this.maskSecrets(targetContent, validatedFindings, data);
        
        // Actions
        const actions = this.determineActions(classification, validatedFindings);
        
        const result = {
            scanKey: this.generateScanKey(data),
            profileId: data.profileId || 'generic',
            path: data.path,
            classification,
            findings: validatedFindings,
            maskedContent: data.options?.includeMasked ? maskedContent : undefined,
            actions,
            scanTimeMs: Date.now() - startTime,
            hash: this.calculateContentHash(content)
        };

        // Actions'ları uygula
        await this.executeActions(result, data);
        
        // Event'leri yayınla
        await this.emitScanEvents(result, data);
        
        return result;
    }

    async getContent(data) {
        if (data.content) {
            return data.content;
        }
        
        if (data.path) {
            // Mock file reading
            return `Sample content from ${data.path}`;
        }
        
        return null;
    }

    parseContent(content, mode) {
        switch (mode) {
            case 'markdown':
                // Extract code blocks and text
                const codeBlockRegex = /```[\s\S]*?```/g;
                const codeBlocks = content.match(codeBlockRegex) || [];
                const textContent = content.replace(codeBlockRegex, '');
                return { text: textContent, code: codeBlocks };
                
            case 'html':
                // Strip HTML tags, extract text
                return { text: content.replace(/<[^>]*>/g, ''), code: [] };
                
            case 'diff':
                // Extract added lines (+ prefix)
                const addedLines = content.split('\n')
                    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
                    .map(line => line.substring(1));
                return { text: addedLines.join('\n'), code: [] };
                
            case 'text':
            default:
                return { text: content, code: [] };
        }
    }

    filterContent(parsedContent, data) {
        const profile = this.config.profiles[data.profileId] || this.config.profiles.generic;
        
        if (profile.diffAware && data.mode === 'diff') {
            // Sadece eklenen içerik taranır
            return parsedContent.text;
        }
        
        // Tüm içerik taranır
        return parsedContent.text + '\n' + parsedContent.code.join('\n');
    }

    detectPatterns(content) {
        const detections = [];
        const lines = content.split('\n');
        
        for (const [patternName, regex] of this.compiledPatterns.entries()) {
            regex.lastIndex = 0; // Reset regex state
            
            let match;
            while ((match = regex.exec(content)) !== null) {
                // Find line number
                const beforeMatch = content.substring(0, match.index);
                const lineNumber = beforeMatch.split('\n').length;
                
                detections.push({
                    type: patternName,
                    match: match[0],
                    fullMatch: match,
                    line: lineNumber,
                    start: match.index,
                    end: match.index + match[0].length,
                    entropy: this.calculateEntropy(match[0])
                });
                
                // Prevent infinite loops with zero-width matches
                if (match.index === regex.lastIndex) {
                    regex.lastIndex++;
                }
            }
        }
        
        return detections;
    }

    calculateEntropy(text) {
        const frequencies = {};
        for (const char of text) {
            frequencies[char] = (frequencies[char] || 0) + 1;
        }
        
        let entropy = 0;
        const length = text.length;
        
        for (const count of Object.values(frequencies)) {
            const probability = count / length;
            entropy -= probability * Math.log2(probability);
        }
        
        return entropy;
    }

    async validateFindings(detections, content) {
        const validatedFindings = [];
        
        for (const detection of detections) {
            const validation = await this.validateDetection(detection, content);
            
            if (validation.isValid) {
                validatedFindings.push({
                    type: this.normalizeSecretType(detection.type),
                    severity: this.calculateSeverity(detection, validation),
                    masked: this.createMask(detection.match),
                    line: detection.line,
                    entropy: detection.entropy,
                    confidence: validation.confidence,
                    metadata: validation.metadata
                });
            }
        }
        
        return validatedFindings;
    }

    async validateDetection(detection, content) {
        const validation = {
            isValid: false,
            confidence: 0.0,
            metadata: {}
        };

        // Entropy check
        if (detection.entropy < this.config.validators.entropyMinBitsPerChar) {
            return validation;
        }

        // Type-specific validation
        switch (detection.type) {
            case 'jwt':
                validation.isValid = await this.validateJWT(detection.match);
                validation.confidence = validation.isValid ? 0.95 : 0.1;
                break;
                
            case 'awsAccessKey':
                validation.isValid = /^AKIA[0-9A-Z]{16}$/.test(detection.match);
                validation.confidence = validation.isValid ? 0.9 : 0.3;
                break;
                
            case 'gcpKeyJson':
                validation.isValid = this.validateGCPKey(detection.fullMatch[0], content);
                validation.confidence = validation.isValid ? 0.9 : 0.2;
                break;
                
            default:
                // Generic validation based on entropy and pattern match
                validation.isValid = detection.entropy >= this.config.validators.entropyMinBitsPerChar;
                validation.confidence = Math.min(detection.entropy / 5.0, 0.8);
        }

        return validation;
    }

    async validateJWT(token) {
        if (!this.config.validators.jwtValidateHeader) {
            return true;
        }
        
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return false;
            
            // Decode header
            const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
            return header.alg && (header.typ === 'JWT' || header.typ === 'JWS');
        } catch (error) {
            return false;
        }
    }

    validateGCPKey(match, content) {
        try {
            // Look for JSON structure around the match
            const startIndex = Math.max(0, content.indexOf(match) - 200);
            const endIndex = Math.min(content.length, content.indexOf(match) + 200);
            const context = content.substring(startIndex, endIndex);
            
            // Check for key GCP service account fields
            return context.includes('"private_key"') && 
                   context.includes('"client_email"') &&
                   context.includes('"project_id"');
        } catch (error) {
            return false;
        }
    }

    normalizeSecretType(patternType) {
        const typeMap = {
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
        
        return typeMap[patternType] || 'UNKNOWN';
    }

    calculateSeverity(detection, validation) {
        if (validation.confidence >= 0.9) return 'high';
        if (validation.confidence >= 0.6) return 'medium';
        return 'low';
    }

    createMask(secret) {
        const style = this.config.redaction.maskStyle;
        
        if (style === 'partial') {
            if (secret.length <= 8) {
                return secret.substring(0, 2) + '*'.repeat(3) + secret.substring(secret.length - 1);
            } else {
                return secret.substring(0, 4) + '*'.repeat(Math.min(secret.length - 8, 10)) + secret.substring(secret.length - 4);
            }
        }
        
        return '*'.repeat(Math.min(secret.length, 20));
    }

    classifyFindings(findings) {
        if (findings.length === 0) return 'SAFE';
        
        const highSeverityCount = findings.filter(f => f.severity === 'high').length;
        const mediumSeverityCount = findings.filter(f => f.severity === 'medium').length;
        
        if (highSeverityCount > 0) return 'LEAK';
        if (mediumSeverityCount > 0) return 'SUSPICIOUS';
        
        return 'SUSPICIOUS';
    }

    maskSecrets(content, findings, data) {
        let maskedContent = content;
        
        // Sort findings by position (descending) to avoid index shifting
        const sortedFindings = findings.sort((a, b) => b.line - a.line);
        
        for (const finding of sortedFindings) {
            // Replace with masked version in content
            // This is a simplified implementation
            maskedContent = maskedContent.replace(
                new RegExp(finding.masked.replace(/\*/g, '.+?'), 'g'),
                finding.masked
            );
        }
        
        return maskedContent;
    }

    determineActions(classification, findings) {
        const actions = [];
        
        if (this.config.policy.blockOn.includes(classification)) {
            actions.push('block_distribution');
        }
        
        if (this.config.policy.quarantineOn.includes(classification)) {
            actions.push('quarantine');
        }
        
        // Type-specific actions
        const hasAWSKeys = findings.some(f => f.type.startsWith('AWS_'));
        const hasJWT = findings.some(f => f.type === 'JWT');
        const hasPrivateKey = findings.some(f => f.type === 'PRIVATE_KEY');
        
        if (hasAWSKeys || hasPrivateKey) {
            actions.push('rotate');
        }
        
        if (hasJWT) {
            actions.push('revoke');
        }
        
        if (classification === 'LEAK') {
            actions.push('notify_compliance');
        }
        
        return actions;
    }

    async executeActions(result, data) {
        for (const action of result.actions) {
            try {
                await this.executeAction(action, result, data);
            } catch (error) {
                this.logger.error(`Action execution failed: ${action}`, error);
                await this.emitAlert('error', 'action_failed', { action, error: error.message });
            }
        }
    }

    async executeAction(action, result, data) {
        switch (action) {
            case 'block_distribution':
                await this.blockDistribution(result, data);
                break;
                
            case 'quarantine':
                await this.quarantineContent(result, data);
                break;
                
            case 'rotate':
                await this.suggestRotation(result, data);
                break;
                
            case 'revoke':
                await this.suggestRevocation(result, data);
                break;
                
            case 'notify_compliance':
                await this.notifyCompliance(result, data);
                break;
        }
    }

    async blockDistribution(result, data) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('secret.block.distribution', {
            event: 'secret.block.distribution',
            timestamp: new Date().toISOString(),
            deliveryKey: data.source?.hash || 'unknown',
            reason: result.classification,
            findings: result.findings.length
        });
        
        this.logger.warn(`Distribution blocked due to secrets: ${result.path}`);
    }

    async quarantineContent(result, data) {
        const vaultRef = `state/quarantine/${new Date().toISOString().split('T')[0]}/${result.hash}.json`;
        
        this.quarantineVault.set(result.hash, {
            path: result.path,
            findings: result.findings,
            quarantinedAt: new Date().toISOString(),
            reason: result.classification
        });
        
        if (this.eventBus) {
            this.eventBus.emit('secret.quarantine', {
                event: 'secret.quarantine',
                timestamp: new Date().toISOString(),
                reason: result.classification,
                path: result.path,
                vaultRef
            });
        }
        
        this.logger.warn(`Content quarantined: ${result.path} -> ${vaultRef}`);
    }

    async suggestRotation(result, data) {
        const awsFindings = result.findings.filter(f => f.type.startsWith('AWS_'));
        const genericFindings = result.findings.filter(f => f.type === 'GENERIC_TOKEN');
        
        if (awsFindings.length > 0) {
            this.emitRotationSuggestion('aws', 'high', 'AWS credentials detected');
        }
        
        if (genericFindings.length > 0) {
            this.emitRotationSuggestion('generic', 'medium', 'Generic tokens detected');
        }
    }

    async suggestRevocation(result, data) {
        const jwtFindings = result.findings.filter(f => f.type === 'JWT');
        
        for (const finding of jwtFindings) {
            this.logger.warn(`JWT revocation suggested: ${finding.masked}`);
        }
    }

    async notifyCompliance(result, data) {
        this.logger.error(`COMPLIANCE ALERT: Secrets leaked in ${result.path}`);
        // Additional compliance notification logic here
    }

    emitRotationSuggestion(kind, urgency, reason) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('secret.rotate.suggest', {
            event: 'secret.rotate.suggest',
            timestamp: new Date().toISOString(),
            kind,
            refHint: 'detected_in_content',
            urgency,
            reason
        });
    }

    async emitScanEvents(result, data) {
        if (!this.eventBus) return;

        // Ana tarama sonucu
        this.eventBus.emit('secret.scan.ready', {
            event: 'secret.scan.ready',
            timestamp: new Date().toISOString(),
            profileId: result.profileId,
            path: result.path,
            classification: result.classification,
            findings: result.findings,
            maskedContent: result.maskedContent,
            actions: result.actions,
            hash: result.hash
        });

        // UI kartı (eğer sızıntı varsa)
        if (result.classification !== 'SAFE') {
            const card = this.createSecretCard(result);
            this.eventBus.emit('secret.card', card);
        }

        // Metrikler
        await this.emitMetrics();
    }

    createSecretCard(result) {
        const leakCount = result.findings.filter(f => f.severity === 'high').length;
        const suspiciousCount = result.findings.filter(f => f.severity === 'medium').length;
        
        let title = 'Gizli Anahtar Kontrolü';
        let body = '';
        let severity = 'info';
        
        if (result.classification === 'LEAK') {
            title = 'Gizli Anahtar Sızıntısı Engellendi';
            severity = 'error';
            
            const types = [...new Set(result.findings.map(f => f.type))];
            body = `${types.join(' & ')} bulguları • dağıtım durduruldu`;
            
            if (result.actions.includes('rotate')) {
                body += ' • rotasyon önerildi';
            }
        } else if (result.classification === 'SUSPICIOUS') {
            title = 'Şüpheli İçerik Tespit Edildi';
            severity = 'warn';
            body = `${suspiciousCount} şüpheli bulgular • inceleme gerekli`;
        }
        
        return {
            event: 'secret.card',
            timestamp: new Date().toISOString(),
            title,
            body,
            severity,
            ttlSec: 900
        };
    }

    async emitMetrics() {
        if (!this.eventBus) return;

        const scans = Array.from(this.scanStore.values()).map(v => v.result);
        const counts = {
            scans: scans.length,
            leaks: scans.filter(s => s.classification === 'LEAK').length,
            suspicious: scans.filter(s => s.classification === 'SUSPICIOUS').length,
            safe: scans.filter(s => s.classification === 'SAFE').length,
            blocked: scans.filter(s => s.actions.includes('block_distribution')).length,
            quarantined: scans.filter(s => s.actions.includes('quarantine')).length
        };

        const avgScanMs = scans.length > 0 
            ? scans.reduce((sum, s) => sum + (s.scanTimeMs || 0), 0) / scans.length 
            : 0;

        this.eventBus.emit('secret.metrics', {
            event: 'secret.metrics',
            timestamp: new Date().toISOString(),
            ...counts,
            avgScanMs: Math.round(avgScanMs * 10) / 10,
            fpRate: 0.01, // Mock false positive rate
            fnGuard: true // Mock false negative guard
        });
    }

    async emitAlert(level, message, context = {}) {
        if (!this.eventBus) return;

        this.eventBus.emit('secret.alert', {
            event: 'secret.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        });
    }

    // Utility methods
    generateScanKey(data) {
        const crypto = require('crypto');
        const contentHash = data.source?.hash || this.calculateContentHash(data.content || data.path || '');
        const profileId = data.profileId || 'generic';
        const forDate = new Date().toISOString().split('T')[0];
        
        return crypto.createHash('sha256').update(`${contentHash}+${profileId}+${forDate}`).digest('hex').substring(0, 16);
    }

    calculateContentHash(content) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(content || '').digest('hex');
    }

    async initializeQuarantineVault() {
        // Mock quarantine vault initialization
        this.logger.debug('Quarantine vault initialized');
    }

    // Event Handlers
    handleScanRequest(data) {
        this.logger.debug(`Direct scan request: ${data.profileId}`);
        this.process(data);
    }

    handleDistributionRequest(data) {
        this.logger.debug(`Distribution request received: ${data.contentRef?.type}`);
        
        // Convert to scan request
        const scanRequest = {
            event: 'secret.scan.request',
            profileId: data.contentRef?.type || 'generic',
            mode: data.contentRef?.format || 'text',
            path: data.contentRef?.path,
            source: { event: 'dist.request', hash: this.calculateContentHash(data.contentRef?.path || '') },
            options: { severity: 'auto', blockOnHigh: true }
        };
        
        this.process(scanRequest);
    }

    handlePolicyDiff(data) {
        this.logger.debug(`Policy diff taraması: ${data.targetVersion}`);
        
        const scanRequest = {
            event: 'secret.scan.request',
            profileId: 'policy',
            mode: 'diff',
            path: data.path,
            source: { event: 'policy.diff.ready', hash: data.path },
            options: { severity: 'high', blockOnHigh: true }
        };
        
        this.process(scanRequest);
    }

    handleNotesReady(data) {
        this.logger.debug(`Notes taraması: ${data.forDate}`);
        
        const scanRequest = {
            event: 'secret.scan.request',
            profileId: 'notes',
            mode: 'markdown',
            path: data.path,
            source: { event: 'notes.daily.ready', hash: data.path }
        };
        
        this.process(scanRequest);
    }

    handleDigestReady(data) {
        this.logger.debug(`Digest taraması: ${data.forDate || 'unknown'}`);
        
        const scanRequest = {
            event: 'secret.scan.request',
            profileId: 'digest',
            mode: 'markdown',
            path: data.path,
            source: { event: 'digest.daily.ready', hash: data.path || '' }
        };
        
        this.process(scanRequest);
    }

    handlePostmortemReady(data) {
        this.logger.debug(`Postmortem taraması: ${data.path || 'unknown'}`);
        
        const scanRequest = {
            event: 'secret.scan.request',
            profileId: 'postmortem',
            mode: 'markdown',
            path: data.path,
            source: { event: 'postmortem.ready', hash: data.hash || '' },
            options: { severity: 'high', blockOnHigh: true }
        };
        
        this.process(scanRequest);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            scans: this.scanStore.size,
            patterns: this.compiledPatterns.size,
            quarantined: this.quarantineVault.size,
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            this.scanStore.clear();
            this.compiledPatterns.clear();
            this.quarantineVault.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = SecretsLeakScanner;