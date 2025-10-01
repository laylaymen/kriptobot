/**
 * LIVIA-40 · privacyRiskScorer.js
 * Kriptobot Modüler Sistem - Privacy Risk Scorer
 * 
 * Amaç: Metin/çıktı/rapor/telemetri/kaynak dosyalarındaki gizlilik riskini gerçek zamanlı hesapla
 * k-anonimlik / l-çeşitlilik / t-yakınlık esinli sezgisel ölçüler + PII dedektörleri (TR odaklı)
 */

const { z } = require('zod');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Zod şemaları
const TextEventSchema = z.object({
  event: z.enum([
    'text.submitted', 'artifact.ready', 'model.output', 
    'kb.ingest.request', 'telemetry.sample', 'consent.ledger.query'
  ]),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?([+-]\d{2}:\d{2}|Z)$/),
  sourceId: z.string().optional(),
  content: z.string().optional(),
  previewText: z.string().optional(),
  lang: z.enum(['tr', 'en', 'auto']).optional(),
  audience: z.enum(['internal', 'partner', 'public']),
  tags: z.object({
    namespace: z.string().default('kb_default'),
    DRILL: z.boolean().default(false),
    SHADOW: z.boolean().default(false)
  }).optional(),
  path: z.string().optional(),
  kind: z.string().optional(),
  purpose: z.string().optional()
}).strict();

const ConfigSchema = z.object({
  detectors: z.object({
    email: z.object({ regex: z.boolean().default(true) }),
    phoneTR: z.object({ 
      pattern: z.string().default("\\b(?:\\+90|0)?\\s?5\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}\\b") 
    }),
    tckn: z.object({ 
      algo: z.literal('mod11').default('mod11'),
      allowFormatted: z.boolean().default(true)
    }),
    ibanTR: z.object({ pattern: z.string().default("\\bTR\\d{24}\\b") }),
    card: z.object({ luhn: z.boolean().default(true) }),
    address: z.object({ ner: z.literal('address').default('address') }),
    personName: z.object({ ner: z.literal('person').default('person') }),
    dob: z.object({ pattern: z.string().default("\\b\\d{2}[./-]\\d{2}[./-]\\d{4}\\b") }),
    geo: z.object({ pattern: z.string().default("\\b(\\d{1,2}\\.\\d+),(\\d{1,2}\\.\\d+)\\b") })
  }),
  quasiIdentifiers: z.array(z.string()).default(['zipcode', 'birth_year', 'gender', 'city', 'employer', 'dept']),
  thresholds: z.object({
    level: z.object({
      low: z.string().default('score<0.3'),
      medium: z.string().default('0.3<=score<0.6'),
      high: z.string().default('0.6<=score<0.8'),
      critical: z.string().default('score>=0.8')
    }),
    blockIf: z.object({
      level: z.literal('critical').default('critical'),
      tcknAny: z.boolean().default(true),
      cardAny: z.boolean().default(true)
    }),
    quarantineIf: z.object({
      massLeakFields: z.array(z.string()).default(['tckn', 'card', 'ibanTR']),
      countGte: z.number().default(3)
    })
  }),
  audiencePolicy: z.object({
    publicMaxLevel: z.literal('low').default('low'),
    partnerMaxLevel: z.literal('medium').default('medium'),
    internalMaxLevel: z.literal('high').default('high')
  }),
  actions: z.object({
    redactVia: z.literal('LIVIA-21').default('LIVIA-21'),
    downgradeAudience: z.boolean().default(true),
    consentCheck: z.boolean().default(true),
    ethicsGateFor: z.string().default('public_high|critical'),
    lineageLink: z.boolean().default(true),
    provenanceAppend: z.boolean().default(true)
  }),
  storage: z.object({
    redactedDir: z.string().default('data/redacted/{YYYY-MM-DD}'),
    quarantineDir: z.string().default('data/quarantine/{YYYY-MM-DD}')
  }),
  idempotencyTtlSec: z.number().default(3600)
}).strict();

class PrivacyRiskScorer {
  constructor(config = {}) {
    this.name = 'PrivacyRiskScorer';
    this.config = ConfigSchema.parse({
      detectors: {},
      quasiIdentifiers: undefined,
      thresholds: {},
      audiencePolicy: {},
      actions: {},
      storage: {},
      ...config
    });
    
    this.isInitialized = false;
    this.logger = null;
    this.eventBus = null;
    
    // İş durumu
    this.state = 'IDLE'; // IDLE, DETECT, SCORE, DECIDE, ENFORCE
    
    // PII detector weights
    this.piiWeights = {
      tckn: 1.0,
      card: 1.0,
      ibanTR: 0.8,
      address: 0.6,
      dob: 0.6,
      email: 0.4,
      phone: 0.4,
      personName: 0.3,
      geo: 0.5
    };
    
    // Scoring model weights
    this.scoringWeights = {
      piiDensity: 0.45,
      kAnonymity: 0.25,
      lDiversity: 0.15,
      tCloseness: 0.10,
      contextAudience: 0.05
    };
    
    // K-anonymity estimation (namespace-based counters)
    this.quasiIdCounts = new Map(); // namespace -> quasiId -> countMap
    this.consentCache = new Map();
    
    // Metrics ve audit
    this.metrics = {
      scored: 0,
      redacted: 0,
      blocked: 0,
      quarantined: 0,
      p95DetectMs: 0,
      p95ScoreMs: 0,
      falsePosRate: 0.02
    };
    
    this.processedHashes = new Set();
    this.auditLog = [];
  }

  async initialize(logger, eventBus) {
    try {
      this.logger = logger;
      this.eventBus = eventBus;
      this.logger.info(`${this.name} başlatılıyor...`);
      
      await this.setupStorage();
      this.setupEventHandlers();
      this.compileDetectorPatterns();
      
      this.isInitialized = true;
      this.logger.info(`${this.name} başarıyla başlatıldı`);
      return true;
    } catch (error) {
      this.logger.error(`${this.name} başlatma hatası:`, error);
      return false;
    }
  }

  async setupStorage() {
    const today = new Date().toISOString().split('T')[0];
    this.redactedPath = path.resolve(this.config.storage.redactedDir.replace('{YYYY-MM-DD}', today));
    this.quarantinePath = path.resolve(this.config.storage.quarantineDir.replace('{YYYY-MM-DD}', today));
    
    await fs.mkdir(this.redactedPath, { recursive: true });
    await fs.mkdir(this.quarantinePath, { recursive: true });
  }

  compileDetectorPatterns() {
    // Compile regex patterns for performance
    this.patterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      phoneTR: new RegExp(this.config.detectors.phoneTR.pattern, 'g'),
      ibanTR: new RegExp(this.config.detectors.ibanTR.pattern, 'g'),
      dob: new RegExp(this.config.detectors.dob.pattern, 'g'),
      geo: new RegExp(this.config.detectors.geo.pattern, 'g'),
      card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g
    };
  }

  setupEventHandlers() {
    if (!this.eventBus) return;

    // Privacy risk olaylarını dinle
    const privacyEvents = [
      'text.submitted', 'artifact.ready', 'model.output',
      'kb.ingest.request', 'telemetry.sample'
    ];

    privacyEvents.forEach(eventType => {
      this.eventBus.on(eventType, async (data) => {
        await this.handlePrivacyEvent(eventType, data);
      });
    });

    // Consent queries
    this.eventBus.on('consent.ledger.query', async (data) => {
      await this.handleConsentQuery(data);
    });
  }

  async handlePrivacyEvent(eventType, data) {
    if (!this.isInitialized) return;

    try {
      this.state = 'DETECT';
      const startTime = Date.now();
      
      // Event'i normalize et
      const normalizedEvent = {
        event: eventType,
        timestamp: data.timestamp || new Date().toISOString(),
        sourceId: data.sourceId || this.generateId(),
        content: data.content || data.previewText || '',
        audience: data.audience || 'internal',
        tags: data.tags || { namespace: 'kb_default', DRILL: false, SHADOW: false },
        lang: data.lang || 'auto',
        path: data.path,
        kind: data.kind,
        purpose: data.purpose
      };

      // Validate
      const validatedEvent = TextEventSchema.parse(normalizedEvent);
      
      // Skip DRILL/SHADOW content unless specifically enabled
      if (validatedEvent.tags?.DRILL || validatedEvent.tags?.SHADOW) {
        this.logger.debug(`DRILL/SHADOW content skipped for privacy scoring`);
        return;
      }
      
      // İdempotency check
      const privacyKey = this.generatePrivacyKey(validatedEvent);
      if (this.processedHashes.has(privacyKey)) {
        this.logger.debug(`Privacy event already processed: ${privacyKey.substring(0, 8)}`);
        return;
      }

      // Detect and score
      const riskScore = await this.calculateRiskScore(validatedEvent);
      
      this.processedHashes.add(privacyKey);
      this.metrics.scored++;
      
      const duration = Date.now() - startTime;
      this.updateMetrics('detect', duration);
      
      // Emit score result
      this.emitPrivacyScore(validatedEvent, riskScore);
      
      // Decide actions if needed
      if (riskScore.score >= 0.3) { // medium or higher
        await this.decideActions(validatedEvent, riskScore);
      }

    } catch (error) {
      this.logger.error(`Privacy event processing error:`, error);
      this.emitAlert('error', 'processing_failed', { event: eventType, sourceId: data.sourceId });
    } finally {
      this.state = 'IDLE';
    }
  }

  async calculateRiskScore(event) {
    this.state = 'SCORE';
    const startTime = Date.now();
    
    const content = event.content || '';
    const namespace = event.tags?.namespace || 'kb_default';
    
    // 1. PII Detection
    const piiSignals = this.detectPII(content);
    
    // 2. K-anonymity estimation
    const kAnonEst = this.estimateKAnonymity(content, namespace);
    
    // 3. L-diversity estimation (simplified)
    const lDiv = this.estimateLDiversity(content, namespace);
    
    // 4. T-closeness approximation (simplified)
    const tClose = this.estimateTCloseness(content, namespace);
    
    // 5. Context/audience penalty
    const audiencePenalty = this.getAudiencePenalty(event.audience);
    
    // 6. Consent penalty (if applicable)
    const consentPenalty = await this.getConsentPenalty(content, event.purpose);
    
    // Calculate composite score
    const piiScore = this.calculatePIIScore(piiSignals);
    const kAnonScore = kAnonEst <= 5 ? (1 / Math.max(kAnonEst, 1)) : 0;
    const lDivScore = lDiv < 2 ? (2 - lDiv) / 2 : 0;
    const tCloseScore = Math.min(tClose, 1);
    
    const baseScore = 
      this.scoringWeights.piiDensity * piiScore +
      this.scoringWeights.kAnonymity * kAnonScore +
      this.scoringWeights.lDiversity * lDivScore +
      this.scoringWeights.tCloseness * tCloseScore +
      this.scoringWeights.contextAudience * audiencePenalty;
    
    const finalScore = Math.min(baseScore + consentPenalty, 1.0);
    
    const level = this.determineRiskLevel(finalScore);
    
    const duration = Date.now() - startTime;
    this.updateMetrics('score', duration);
    
    return {
      score: finalScore,
      level,
      signals: {
        pii: piiSignals,
        quasiIds: this.extractQuasiIds(content),
        kAnonEst,
        lDiv,
        tClose
      },
      actions: this.determineActions(finalScore, level, piiSignals, event.audience),
      hash: this.hashContent(content)
    };
  }

  detectPII(content) {
    const signals = {
      email: 0, phone: 0, tckn: 0, iban: 0, card: 0,
      address: 0, dob: 0, geo: 0, personName: 0
    };
    
    // Email detection
    const emails = content.match(this.patterns.email);
    signals.email = emails ? emails.length : 0;
    
    // Turkish phone detection
    const phones = content.match(this.patterns.phoneTR);
    signals.phone = phones ? phones.length : 0;
    
    // TCKN detection (Turkish National ID)
    const tcknMatches = content.match(/\b\d{11}\b/g);
    if (tcknMatches) {
      signals.tckn = tcknMatches.filter(num => this.validateTCKN(num)).length;
    }
    
    // IBAN TR detection
    const ibans = content.match(this.patterns.ibanTR);
    signals.iban = ibans ? ibans.length : 0;
    
    // Credit card detection (Luhn algorithm)
    const cards = content.match(this.patterns.card);
    if (cards) {
      signals.card = cards.filter(card => this.validateLuhn(card.replace(/[-\s]/g, ''))).length;
    }
    
    // Date of birth detection
    const dobs = content.match(this.patterns.dob);
    signals.dob = dobs ? dobs.length : 0;
    
    // Geographic coordinates
    const geos = content.match(this.patterns.geo);
    signals.geo = geos ? geos.length : 0;
    
    // Address and person name would require NER (simplified here)
    signals.address = this.simpleAddressDetection(content);
    signals.personName = this.simplePersonNameDetection(content);
    
    return signals;
  }

  validateTCKN(tckn) {
    if (!/^\d{11}$/.test(tckn)) return false;
    
    const digits = tckn.split('').map(Number);
    const sum1 = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
    const sum2 = digits[1] + digits[3] + digits[5] + digits[7];
    const check1 = (sum1 * 7 - sum2) % 10;
    const check2 = (sum1 + sum2 + digits[9]) % 10;
    
    return check1 === digits[9] && check2 === digits[10];
  }

  validateLuhn(cardNumber) {
    let sum = 0;
    let isEven = false;
    
    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i]);
      
      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      
      sum += digit;
      isEven = !isEven;
    }
    
    return sum % 10 === 0;
  }

  simpleAddressDetection(content) {
    // Simplified address detection using Turkish address patterns
    const addressPatterns = [
      /\b\w+\s+(Mahallesi|Mah\.?)\b/gi,
      /\b\w+\s+(Caddesi|Cad\.?)\b/gi,
      /\b\w+\s+(Sokağı|Sok\.?)\b/gi,
      /\bNo:\s*\d+/gi
    ];
    
    let count = 0;
    addressPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    });
    
    return Math.min(count, 5); // Cap at 5
  }

  simplePersonNameDetection(content) {
    // Very basic Turkish name detection
    const namePattern = /\b[A-ZÇĞIÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞIÖŞÜ][a-zçğıöşü]+\b/g;
    const matches = content.match(namePattern);
    return matches ? Math.min(matches.length, 10) : 0;
  }

  extractQuasiIds(content) {
    const quasiIds = [];
    
    // Simple extraction of quasi-identifiers
    this.config.quasiIdentifiers.forEach(qid => {
      if (content.toLowerCase().includes(qid.toLowerCase())) {
        quasiIds.push(qid);
      }
    });
    
    return quasiIds;
  }

  estimateKAnonymity(content, namespace) {
    // Simplified k-anonymity estimation
    // In practice, this would analyze the quasi-identifier combinations
    const quasiIds = this.extractQuasiIds(content);
    if (quasiIds.length === 0) return 10; // No quasi-identifiers
    
    // Mock estimation based on quasi-id count
    return Math.max(1, 15 - quasiIds.length * 3);
  }

  estimateLDiversity(content, namespace) {
    // Simplified l-diversity estimation
    // Would analyze sensitive attribute diversity in practice
    return 2; // Default safe value
  }

  estimateTCloseness(content, namespace) {
    // Simplified t-closeness estimation
    // Would calculate distance between group and population distributions
    return 0.3; // Default moderate value
  }

  getAudiencePenalty(audience) {
    const penalties = {
      'internal': 0.0,
      'partner': 0.1,
      'public': 0.2
    };
    return penalties[audience] || 0.1;
  }

  async getConsentPenalty(content, purpose) {
    // Simplified consent check
    // In practice, would hash subject info and check consent ledger
    return 0.0; // Default no penalty
  }

  calculatePIIScore(piiSignals) {
    let score = 0;
    let totalCount = 0;
    
    Object.entries(piiSignals).forEach(([type, count]) => {
      if (count > 0) {
        const weight = this.piiWeights[type] || 0.3;
        score += weight * Math.min(count / 5, 1); // Normalize by max 5 instances
        totalCount += count;
      }
    });
    
    // Normalize by content length approximation
    return Math.min(score, 1.0);
  }

  determineRiskLevel(score) {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.3) return 'medium';
    return 'low';
  }

  determineActions(score, level, piiSignals, audience) {
    const actions = [];
    
    // Determine redaction needs
    const needsRedaction = Object.entries(piiSignals).filter(([type, count]) => count > 0);
    if (needsRedaction.length > 0) {
      actions.push('redact');
    }
    
    // Masking for certain types
    if (piiSignals.iban > 0 || piiSignals.card > 0) {
      actions.push('mask');
    }
    
    // Consent check
    if (level === 'medium' || level === 'high') {
      actions.push('consent_check');
    }
    
    // Quarantine critical risks
    if (level === 'critical' || 
        (piiSignals.tckn > 0 && piiSignals.card > 0) ||
        (piiSignals.tckn >= 3)) {
      actions.push('quarantine');
    }
    
    return actions;
  }

  async decideActions(event, riskScore) {
    this.state = 'DECIDE';
    
    // Check audience policy violations
    const maxAllowedLevel = this.config.audiencePolicy[event.audience + 'MaxLevel'];
    const violatesPolicy = this.levelToNumber(riskScore.level) > this.levelToNumber(maxAllowedLevel);
    
    if (violatesPolicy) {
      this.emitAlert('warn', 'audience_policy_violation', {
        sourceId: event.sourceId,
        audience: event.audience,
        level: riskScore.level,
        maxAllowed: maxAllowedLevel
      });
    }
    
    // Emit action proposal
    this.emitActionProposal(event, riskScore);
    
    // Auto-enforce if enabled
    if (this.config.actions.redactVia && riskScore.actions.includes('redact')) {
      await this.enforceRedaction(event, riskScore);
    }
  }

  async enforceRedaction(event, riskScore) {
    this.state = 'ENFORCE';
    
    try {
      // In practice, would call LIVIA-21 for redaction
      const outputPath = path.join(this.redactedPath, `${event.sourceId}_redacted.txt`);
      
      // Mock redaction (in practice would use LIVIA-21)
      const redactedContent = this.mockRedaction(event.content, riskScore.signals.pii);
      await fs.writeFile(outputPath, redactedContent);
      
      this.metrics.redacted++;
      
      this.emitPrivacyEnforced(event, 'ok', { path: outputPath });
      
    } catch (error) {
      this.logger.error('Redaction enforcement failed:', error);
      this.emitAlert('error', 'redact_failed', { sourceId: event.sourceId });
    }
  }

  mockRedaction(content, piiSignals) {
    let redacted = content;
    
    // Replace emails
    redacted = redacted.replace(this.patterns.email, '[EMAIL_REDACTED]');
    
    // Replace phones
    redacted = redacted.replace(this.patterns.phoneTR, '[PHONE_REDACTED]');
    
    // Replace IBANs
    redacted = redacted.replace(this.patterns.ibanTR, '[IBAN_REDACTED]');
    
    // Replace dates
    redacted = redacted.replace(this.patterns.dob, '[DATE_REDACTED]');
    
    return redacted;
  }

  levelToNumber(level) {
    const mapping = { 'low': 1, 'medium': 2, 'high': 3, 'critical': 4 };
    return mapping[level] || 1;
  }

  emitPrivacyScore(event, riskScore) {
    this.eventBus?.emit('privacy.score.ready', {
      event: 'privacy.score.ready',
      timestamp: new Date().toISOString(),
      sourceId: event.sourceId,
      contentHash: riskScore.hash,
      audience: event.audience,
      score: riskScore.score,
      level: riskScore.level,
      signals: riskScore.signals,
      actions: riskScore.actions,
      hash: riskScore.hash
    });
  }

  emitActionProposal(event, riskScore) {
    if (riskScore.level === 'low') return;
    
    const plan = {
      redact: [],
      mask: [],
      downgradeAudience: null,
      blockPublish: false
    };
    
    // Determine specific redactions
    Object.entries(riskScore.signals.pii).forEach(([type, count]) => {
      if (count > 0 && ['email', 'phone', 'tckn', 'address'].includes(type)) {
        plan.redact.push(type);
      }
      if (count > 0 && ['iban', 'card'].includes(type)) {
        plan.mask.push(type);
      }
    });
    
    // Audience downgrade
    if (riskScore.level === 'high' && event.audience === 'public') {
      plan.downgradeAudience = 'internal';
    }
    
    this.eventBus?.emit('privacy.action.proposed', {
      event: 'privacy.action.proposed',
      timestamp: new Date().toISOString(),
      sourceId: event.sourceId,
      level: riskScore.level,
      plan
    });
  }

  emitPrivacyEnforced(event, result, outputRef) {
    this.eventBus?.emit('privacy.enforced', {
      event: 'privacy.enforced',
      timestamp: new Date().toISOString(),
      sourceId: event.sourceId,
      result,
      outputRef,
      via: this.config.actions.redactVia
    });
  }

  emitAlert(level, message, context = {}) {
    this.eventBus?.emit('privacy.alert', {
      event: 'privacy.alert',
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    });
  }

  async handleConsentQuery(data) {
    // Mock consent check
    const result = {
      event: 'consent.result',
      timestamp: new Date().toISOString(),
      subjectHash: data.subjectHash,
      purpose: data.purpose,
      result: 'granted', // Mock result
      expiresAt: null
    };
    
    this.eventBus?.emit('consent.result', result);
  }

  updateMetrics(operation, duration) {
    if (operation === 'detect') {
      this.metrics.p95DetectMs = this.updateP95(this.metrics.p95DetectMs, duration);
    } else if (operation === 'score') {
      this.metrics.p95ScoreMs = this.updateP95(this.metrics.p95ScoreMs, duration);
    }
  }

  updateP95(currentP95, newValue) {
    const alpha = 0.1;
    return currentP95 * (1 - alpha) + newValue * alpha;
  }

  generatePrivacyKey(event) {
    const keyData = {
      sourceId: event.sourceId,
      contentHash: this.hashContent(event.content || ''),
      scope: event.tags?.namespace || 'default',
      windowISO: new Date().toISOString().split('T')[0]
    };
    return crypto.createHash('md5').update(JSON.stringify(keyData)).digest('hex');
  }

  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  generateId() {
    return `priv:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  }

  getStatus() {
    return {
      name: this.name,
      initialized: this.isInitialized,
      state: this.state,
      metrics: this.metrics,
      config: this.config
    };
  }

  async getMetrics() {
    return {
      timestamp: new Date().toISOString(),
      ...this.metrics,
      state: this.state,
      processedHashesSize: this.processedHashes.size
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

module.exports = PrivacyRiskScorer;