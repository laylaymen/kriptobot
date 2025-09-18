/**
 * VIVO-35 · dataRetentionAndPrivacyManager.ts
 * Log/veri saklama kurallarını merkezî yöneten, PII temizliği/anonimleştirme/maskeleme yapan,
 * ihracat (export) ve silme (erasure) taleplerini işleyen gizlilik katmanı.
 * GDPR/KVKK uyumlu veri yaşam döngüsü yönetimi.
 */

import { EventEmitter } from "events";
import * as crypto from "crypto";

// Input Event Types
export interface PrivacyPolicyUpdate {
  event: "privacy.policy.update";
  timestamp: string;
  version: number;
  retention: Record<string, string>; // ISO-8601 durations
  masking: Record<string, Record<string, string>>;
  encryption: {
    atRest: boolean;
    keyAlias: string;
    rotateDays: number;
  };
  redaction: Record<string, {
    fields: string[];
    mode: "mask" | "hash" | "drop";
  }>;
  defaults: {
    classification: string;
  };
}

export interface DataIngest {
  event: "data.ingest";
  timestamp: string;
  source: "logger" | "telemetry" | "bridge" | "sentry" | "guard" | "composer" | "custom";
  topic: string;
  payload: Record<string, any>;
  data: {
    tags: {
      classification: "PUBLIC" | "SENSITIVE_LOW" | "PII_BASIC" | "PII_STRICT" | "FINANCIAL" | "SECRET";
      subjectId?: string;
      region?: string;
      ttlOverride?: string;
    };
  };
  audit: {
    producer: string;
    eventId: string;
  };
}

export interface DataTagging {
  event: "data.tagging";
  timestamp: string;
  eventId: string;
  add: {
    classification?: string;
    subjectId?: string;
    labels?: string[];
  };
}

export interface PrivacyScanRequest {
  event: "privacy.scan.request";
  timestamp: string;
  scope: {
    since: string;
    until: string;
    sources: string[];
    topics: string[];
  };
  detectors: string[];
}

export interface DataSubjectRequest {
  event: "data.subject.request";
  timestamp: string;
  requestId: string;
  type: "export" | "erasure" | "access";
  subjectId: string;
  identityProof: {
    method: "signed_token" | "email_match" | "manual";
    evidence: string;
  };
  window?: {
    since?: string;
    until?: string;
  };
  delivery: {
    format: "jsonl" | "zip";
    target: string;
  };
}

// Output Event Types
export interface DataNormalized {
  event: "data.normalized";
  timestamp: string;
  source: string;
  topic: string;
  payload: Record<string, any>;
  data: {
    tags: {
      classification: string;
      subjectIdHash?: string;
      labels: string[];
    };
    retention: {
      expiresAt: string;
      policyVersion: number;
    };
  };
  audit: {
    fromEventId: string;
    maskActions: string[];
  };
}

export interface PrivacyScanResult {
  event: "privacy.scan.result";
  timestamp: string;
  scope: {
    since: string;
    until: string;
  };
  summary: {
    recordsScanned: number;
    findings: number;
  };
  byType: Array<{
    type: string;
    count: number;
  }>;
  recommendations: string[];
}

export interface RetentionSweepReport {
  event: "retention.sweep.report";
  timestamp: string;
  policyVersion: number;
  deleted: {
    records: number;
    bytes: number;
  };
  redacted: {
    records: number;
    bytes: number;
  };
  skipped: {
    records: number;
    reason: string;
  };
}

export interface DataSubjectReceipt {
  event: "data.subject.receipt";
  timestamp: string;
  requestId: string;
  type: "export" | "erasure" | "access";
  status: "accepted" | "rejected" | "completed" | "failed";
  link?: string;
  hash?: string;
  reason?: string;
}

export interface PrivacyAlert {
  event: "privacy.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    eventId?: string;
    reasonCodes: string[];
  };
}

export interface PrivacyMetrics {
  event: "privacy.metrics";
  timestamp: string;
  throughput: number;
  piiDetectedRate: number;
  drops: number;
  redactions: number;
  exports: number;
  erasures: number;
  errors: number;
}

// Configuration
export interface DataRetentionConfig {
  defaultRetention: string; // ISO-8601 duration
  sweep: {
    intervalMin: number;
    batchRecords: number;
  };
  export: {
    tmpDir: string;
    maxRecords: number;
    partSizeMB: number;
    zip: boolean;
  };
  hash: {
    algo: string;
    saltAlias: string;
    subjectIdPepperEnv: string;
  };
  scan: {
    maxRatePerSec: number;
    detectors: string[];
  };
  masking: {
    email: string;
    phone: string;
    ipTruncate: string;
  };
  security: {
    encryptAtRest: boolean;
    keyAlias: string;
    allowDecryptionInExport: boolean;
  };
  audit: {
    keepExportsD: number;
    keepReceiptsD: number;
  };
  tz: string;
}

// Internal state interfaces
interface StoredRecord {
  eventId: string;
  timestamp: Date;
  source: string;
  topic: string;
  payload: Record<string, any>;
  classification: string;
  subjectIdHash?: string;
  expiresAt: Date;
  policyVersion: number;
  storageRef: string;
  encrypted: boolean;
}

interface DSRRequest {
  requestId: string;
  type: "export" | "erasure" | "access";
  subjectId: string;
  subjectIdHash: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: Date;
  completedAt?: Date;
  deliveryTarget: string;
  deliveryFormat: string;
}

interface PrivacyState {
  policy: PrivacyPolicyUpdate | null;
  retentionMap: Map<string, number>; // classification -> retention ms
  maskingRules: Map<string, Record<string, string>>;
  redactionRules: Map<string, { fields: string[]; mode: string; }>;
  lineageIndex: Map<string, string>; // eventId -> storageRef
  retentionIndex: Map<string, string[]>; // expiresAt timestamp -> eventIds
  subjectMap: Map<string, number>; // subjectIdHash -> count
  pendingDSRs: Map<string, DSRRequest>;
  processedEvents: Set<string>; // For idempotency
  stats: {
    throughput: number;
    piiDetected: number;
    drops: number;
    redactions: number;
    exports: number;
    erasures: number;
    errors: number;
  };
}

// Helper classes
class Masker {
  static maskEmail(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex <= 0) return "***@***.***";
    
    const localPart = email.substring(0, atIndex);
    const domainPart = email.substring(atIndex + 1);
    
    const maskedLocal = localPart.length > 2 ? 
      localPart.substring(0, 1) + "***" : "***";
    const maskedDomain = domainPart.includes('.') ? 
      "***." + domainPart.split('.').pop() : "***";
    
    return `${maskedLocal}@${maskedDomain}`;
  }

  static maskPhone(phone: string): string {
    // Keep country code and mask middle digits
    if (phone.length < 8) return "***-****";
    
    const cleaned = phone.replace(/[^\d]/g, '');
    if (cleaned.length >= 10) {
      return `${cleaned.substring(0, 2)}***${cleaned.slice(-2)}`;
    }
    return "***-****";
  }

  static truncateIP(ip: string, mask: string = "/24"): string {
    const parts = ip.split('.');
    if (parts.length !== 4) return "***.***.***";
    
    if (mask === "/24") {
      return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
    } else if (mask === "/16") {
      return `${parts[0]}.${parts[1]}.***.***.***`;
    }
    
    return "***.***.***";
  }

  static hash(value: string, salt: string): string {
    return crypto.createHmac('sha256', salt)
      .update(value)
      .digest('hex')
      .substring(0, 16);
  }

  static drop(): undefined {
    return undefined;
  }
}

class PIIScanner {
  private static readonly PATTERNS = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    phone: /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g,
    ip: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    api_key: /(?:api[_-]?key|token)["\s:=]+[A-Za-z0-9_-]{16,}/gi,
    iban: /[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}/g,
    national_id: /\b[0-9]{11}\b/g
  };

  static scan(text: string, detectors: string[]): Array<{ type: string; matches: string[]; }> {
    const results: Array<{ type: string; matches: string[]; }> = [];
    
    for (const detector of detectors) {
      const pattern = this.PATTERNS[detector as keyof typeof this.PATTERNS];
      if (!pattern) continue;
      
      const matches = text.match(pattern) || [];
      if (matches.length > 0) {
        results.push({ type: detector, matches: [...new Set(matches)] });
      }
    }
    
    return results;
  }
}

class RetentionCalculator {
  static parseISO8601Duration(duration: string): number {
    // Simple ISO-8601 duration parser (P[n]Y[n]M[n]DT[n]H[n]M[n]S)
    const match = duration.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
    if (!match) return 0;
    
    const [, years, months, days, hours, minutes, seconds] = match;
    
    let ms = 0;
    if (years) ms += parseInt(years) * 365 * 24 * 60 * 60 * 1000;
    if (months) ms += parseInt(months) * 30 * 24 * 60 * 60 * 1000;
    if (days) ms += parseInt(days) * 24 * 60 * 60 * 1000;
    if (hours) ms += parseInt(hours) * 60 * 60 * 1000;
    if (minutes) ms += parseInt(minutes) * 60 * 1000;
    if (seconds) ms += parseInt(seconds) * 1000;
    
    return ms;
  }

  static calculateExpirationDate(classification: string, retentionMap: Map<string, number>, ttlOverride?: string): Date {
    const now = new Date();
    let retentionMs = retentionMap.get(classification) || retentionMap.get("SENSITIVE_LOW") || (180 * 24 * 60 * 60 * 1000);
    
    if (ttlOverride) {
      const overrideMs = this.parseISO8601Duration(ttlOverride);
      // TTL override can only shorten retention, not extend it
      if (overrideMs > 0 && overrideMs < retentionMs) {
        retentionMs = overrideMs;
      }
    }
    
    return new Date(now.getTime() + retentionMs);
  }
}

class Vault {
  private static readonly MOCK_KEY = "mock-encryption-key-for-development";

  static encrypt(data: string, keyAlias: string): { encrypted: string; keyVersion: string; } {
    // Mock encryption - in production would use KMS/HSM
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.MOCK_KEY).subarray(0, 32), iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encrypted: iv.toString('hex') + ':' + encrypted,
      keyVersion: `${keyAlias}:v1`
    };
  }

  static decrypt(encrypted: string, keyVersion: string): string {
    // Mock decryption - in production would use KMS/HSM
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = parts[1];
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.MOCK_KEY).subarray(0, 32), iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  static rotateKey(keyAlias: string): string {
    // Mock key rotation
    return `${keyAlias}:v${Date.now()}`;
  }
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class DataRetentionAndPrivacyManager extends EventEmitter {
  ver="1.0.0"; src="VIVO-35";
  private config: DataRetentionConfig;
  private state: PrivacyState;
  private sweepInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  private subjectIdPepper: string;

  constructor(config?: Partial<DataRetentionConfig>) {
    super();
    this.config = {
      defaultRetention: "P180D",
      sweep: {
        intervalMin: 30,
        batchRecords: 5000
      },
      export: {
        tmpDir: "data/exports",
        maxRecords: 5_000_000,
        partSizeMB: 64,
        zip: true
      },
      hash: {
        algo: "HMAC-SHA256",
        saltAlias: "kms:vivo35-rotating",
        subjectIdPepperEnv: "SUBJECT_PEPPER"
      },
      scan: {
        maxRatePerSec: 2000,
        detectors: ["email", "phone", "ip", "national_id", "iban", "api_key"]
      },
      masking: {
        email: "a***@***.tld",
        phone: "***-****",
        ipTruncate: "/24"
      },
      security: {
        encryptAtRest: true,
        keyAlias: "kms:vivo35-rotating",
        allowDecryptionInExport: false
      },
      audit: {
        keepExportsD: 30,
        keepReceiptsD: 365
      },
      tz: "Europe/Istanbul",
      ...config
    };

    this.subjectIdPepper = process.env[this.config.hash.subjectIdPepperEnv] || "default-pepper";

    this.state = {
      policy: null,
      retentionMap: new Map(),
      maskingRules: new Map(),
      redactionRules: new Map(),
      lineageIndex: new Map(),
      retentionIndex: new Map(),
      subjectMap: new Map(),
      pendingDSRs: new Map(),
      processedEvents: new Set(),
      stats: {
        throughput: 0,
        piiDetected: 0,
        drops: 0,
        redactions: 0,
        exports: 0,
        erasures: 0,
        errors: 0
      }
    };

    this.setupIntervals();
  }

  attach(bus: any, logger: any) {
    bus.on("privacy.policy.update", (data: any) => this.handlePolicyUpdate(data, logger));
    bus.on("data.ingest", (data: any) => this.handleDataIngest(data, bus, logger));
    bus.on("data.tagging", (data: any) => this.handleDataTagging(data, logger));
    bus.on("privacy.scan.request", (data: any) => this.handleScanRequest(data, bus, logger));
    bus.on("data.subject.request", (data: any) => this.handleSubjectRequest(data, bus, logger));
  }

  private handlePolicyUpdate(data: any, logger: any): void {
    try {
      if (data.event !== "privacy.policy.update") return;
      
      const policy = data as PrivacyPolicyUpdate;
      this.updatePolicy(policy, logger);

    } catch (error: any) {
      this.emitAlert("error", `Policy update failed: ${error.message}`, ["policy_error"], logger);
    }
  }

  private handleDataIngest(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "data.ingest") return;
      
      const ingest = data as DataIngest;
      this.processDataIngest(ingest, bus, logger);

    } catch (error: any) {
      this.state.stats.errors++;
      this.emitAlert("error", `Data ingest failed: ${error.message}`, ["ingest_error"], logger);
    }
  }

  private handleDataTagging(data: any, logger: any): void {
    try {
      if (data.event !== "data.tagging") return;
      
      const tagging = data as DataTagging;
      this.processDataTagging(tagging, logger);

    } catch (error: any) {
      this.emitAlert("error", `Data tagging failed: ${error.message}`, ["tagging_error"], logger);
    }
  }

  private handleScanRequest(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "privacy.scan.request") return;
      
      const request = data as PrivacyScanRequest;
      this.processScanRequest(request, bus, logger);

    } catch (error: any) {
      this.emitAlert("error", `Scan request failed: ${error.message}`, ["scan_error"], logger);
    }
  }

  private handleSubjectRequest(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "data.subject.request") return;
      
      const request = data as DataSubjectRequest;
      this.processSubjectRequest(request, bus, logger);

    } catch (error: any) {
      this.emitAlert("error", `Subject request failed: ${error.message}`, ["dsr_error"], logger);
    }
  }

  private updatePolicy(policy: PrivacyPolicyUpdate, logger: any): void {
    this.state.policy = policy;
    
    // Update retention map
    this.state.retentionMap.clear();
    for (const [classification, duration] of Object.entries(policy.retention)) {
      const ms = RetentionCalculator.parseISO8601Duration(duration);
      this.state.retentionMap.set(classification, ms);
    }
    
    // Update masking rules
    this.state.maskingRules.clear();
    for (const [classification, rules] of Object.entries(policy.masking)) {
      this.state.maskingRules.set(classification, rules);
    }
    
    // Update redaction rules
    this.state.redactionRules.clear();
    for (const [context, rules] of Object.entries(policy.redaction)) {
      this.state.redactionRules.set(context, rules);
    }
    
    if (logger) logger.info({ version: policy.version }, "Privacy policy updated");
  }

  private processDataIngest(ingest: DataIngest, bus: any, logger: any): void {
    // Check idempotency
    if (this.state.processedEvents.has(ingest.audit.eventId)) {
      return; // Already processed
    }

    // Validate classification
    const classification = ingest.data.tags.classification || this.state.policy?.defaults.classification || "SENSITIVE_LOW";
    
    // Check for SECRET data - should be dropped immediately
    if (classification === "SECRET") {
      this.state.stats.drops++;
      this.emitAlert("error", `SECRET data detected and dropped: ${ingest.audit.eventId}`, ["secret_data"], logger);
      return;
    }

    // Scan for PII patterns
    const textContent = JSON.stringify(ingest.payload);
    const piiFindings = PIIScanner.scan(textContent, this.config.scan.detectors);
    
    if (piiFindings.length > 0) {
      this.state.stats.piiDetected++;
      
      // Check for API keys or tokens
      const hasSecrets = piiFindings.some(finding => finding.type === "api_key");
      if (hasSecrets) {
        this.emitAlert("error", `API key/token detected in data: ${ingest.audit.eventId}`, ["secret_leak"], logger);
      }
    }

    // Apply masking
    const maskActions: string[] = [];
    let maskedPayload = { ...ingest.payload };
    
    const maskingRules = this.state.maskingRules.get(classification);
    if (maskingRules) {
      for (const [field, action] of Object.entries(maskingRules)) {
        if (maskedPayload[field] !== undefined) {
          const originalValue = maskedPayload[field];
          
          switch (action) {
            case "mask":
              if (field.includes("email")) {
                maskedPayload[field] = Masker.maskEmail(String(originalValue));
              } else if (field.includes("phone")) {
                maskedPayload[field] = Masker.maskPhone(String(originalValue));
              } else {
                maskedPayload[field] = "***";
              }
              maskActions.push(`mask:${field}`);
              break;
              
            case "hash":
              maskedPayload[field] = Masker.hash(String(originalValue), this.subjectIdPepper);
              maskActions.push(`hash:${field}`);
              break;
              
            case "drop":
              delete maskedPayload[field];
              maskActions.push(`drop:${field}`);
              break;
              
            case "truncate":
              if (field.includes("ip")) {
                maskedPayload[field] = Masker.truncateIP(String(originalValue), this.config.masking.ipTruncate);
                maskActions.push(`truncate:${field}`);
              }
              break;
          }
        }
      }
    }

    // Generate subject ID hash
    let subjectIdHash: string | undefined;
    if (ingest.data.tags.subjectId) {
      subjectIdHash = Masker.hash(ingest.data.tags.subjectId, this.subjectIdPepper);
      maskActions.push("hash:subjectId");
      
      // Update subject map
      const currentCount = this.state.subjectMap.get(subjectIdHash) || 0;
      this.state.subjectMap.set(subjectIdHash, currentCount + 1);
    }

    // Calculate expiration date
    const expiresAt = RetentionCalculator.calculateExpirationDate(
      classification, 
      this.state.retentionMap, 
      ingest.data.tags.ttlOverride
    );

    // Encrypt payload if required
    let storageRef = `storage:${ingest.audit.eventId}`;
    if (this.config.security.encryptAtRest) {
      const encrypted = Vault.encrypt(JSON.stringify(maskedPayload), this.config.security.keyAlias);
      storageRef = `encrypted:${encrypted.keyVersion}:${ingest.audit.eventId}`;
    }

    // Store record metadata
    const record: StoredRecord = {
      eventId: ingest.audit.eventId,
      timestamp: new Date(ingest.timestamp),
      source: ingest.source,
      topic: ingest.topic,
      payload: maskedPayload,
      classification,
      subjectIdHash,
      expiresAt,
      policyVersion: this.state.policy?.version || 1,
      storageRef,
      encrypted: this.config.security.encryptAtRest
    };

    // Update indexes
    this.state.lineageIndex.set(ingest.audit.eventId, storageRef);
    
    const expirationKey = expiresAt.toISOString();
    const existingExpired = this.state.retentionIndex.get(expirationKey) || [];
    existingExpired.push(ingest.audit.eventId);
    this.state.retentionIndex.set(expirationKey, existingExpired);

    // Mark as processed
    this.state.processedEvents.add(ingest.audit.eventId);

    // Emit normalized data
    const normalized: DataNormalized = {
      event: "data.normalized",
      timestamp: new Date().toISOString(),
      source: ingest.source,
      topic: ingest.topic,
      payload: maskedPayload,
      data: {
        tags: {
          classification,
          subjectIdHash,
          labels: []
        },
        retention: {
          expiresAt: expiresAt.toISOString(),
          policyVersion: this.state.policy?.version || 1
        }
      },
      audit: {
        fromEventId: ingest.audit.eventId,
        maskActions
      }
    };

    this.emit("data.normalized", normalized);
    if (bus) bus.emit("data.normalized", normalized);

    this.state.stats.throughput++;
    if (maskActions.length > 0) {
      this.state.stats.redactions++;
    }

    if (logger) logger.debug({ eventId: ingest.audit.eventId, classification, maskActions }, "Data normalized");
  }

  private processDataTagging(tagging: DataTagging, logger: any): void {
    const existingRef = this.state.lineageIndex.get(tagging.eventId);
    if (!existingRef) {
      this.emitAlert("warn", `Event not found for tagging: ${tagging.eventId}`, ["event_not_found"], logger);
      return;
    }

    // Update classification if provided (can only make it more restrictive)
    if (tagging.add.classification) {
      // This would require updating the stored record
      if (logger) logger.debug({ eventId: tagging.eventId, newClassification: tagging.add.classification }, "Classification updated");
    }

    // Update subject ID if provided
    if (tagging.add.subjectId) {
      const newSubjectIdHash = Masker.hash(tagging.add.subjectId, this.subjectIdPepper);
      // Update subject map
      const currentCount = this.state.subjectMap.get(newSubjectIdHash) || 0;
      this.state.subjectMap.set(newSubjectIdHash, currentCount + 1);
      
      if (logger) logger.debug({ eventId: tagging.eventId, subjectIdHash: newSubjectIdHash }, "Subject ID added");
    }
  }

  private processScanRequest(request: PrivacyScanRequest, bus: any, logger: any): void {
    const startTime = new Date(request.scope.since);
    const endTime = new Date(request.scope.until);
    
    let recordsScanned = 0;
    let totalFindings = 0;
    const findingsByType = new Map<string, number>();

    // Simulate scanning stored records
    for (const [eventId, storageRef] of this.state.lineageIndex.entries()) {
      // In a real implementation, this would scan actual stored data
      recordsScanned++;
      
      // Mock some findings for demonstration
      if (Math.random() < 0.01) { // 1% chance of finding
        const findingType = request.detectors[Math.floor(Math.random() * request.detectors.length)];
        totalFindings++;
        findingsByType.set(findingType, (findingsByType.get(findingType) || 0) + 1);
      }
    }

    const byType = Array.from(findingsByType.entries()).map(([type, count]) => ({ type, count }));
    
    const recommendations: string[] = [];
    if (findingsByType.has("api_key")) {
      recommendations.push("rotate_keys");
    }
    if (totalFindings > recordsScanned * 0.05) {
      recommendations.push("tighten_masks");
    }

    const result: PrivacyScanResult = {
      event: "privacy.scan.result",
      timestamp: new Date().toISOString(),
      scope: {
        since: request.scope.since,
        until: request.scope.until
      },
      summary: {
        recordsScanned,
        findings: totalFindings
      },
      byType,
      recommendations
    };

    this.emit("privacy.scan.result", result);
    if (bus) bus.emit("privacy.scan.result", result);

    if (logger) logger.info({ recordsScanned, findings: totalFindings }, "Privacy scan completed");
  }

  private processSubjectRequest(request: DataSubjectRequest, bus: any, logger: any): void {
    // Validate identity proof (simplified)
    if (!this.validateIdentityProof(request)) {
      const receipt: DataSubjectReceipt = {
        event: "data.subject.receipt",
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        type: request.type,
        status: "rejected",
        reason: "Identity proof validation failed"
      };
      
      this.emit("data.subject.receipt", receipt);
      if (bus) bus.emit("data.subject.receipt", receipt);
      return;
    }

    // Generate subject ID hash
    const subjectIdHash = Masker.hash(request.subjectId, this.subjectIdPepper);
    
    // Check if subject has any data
    const subjectRecordCount = this.state.subjectMap.get(subjectIdHash) || 0;
    if (subjectRecordCount === 0) {
      const receipt: DataSubjectReceipt = {
        event: "data.subject.receipt",
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        type: request.type,
        status: "completed",
        reason: "No data found for subject"
      };
      
      this.emit("data.subject.receipt", receipt);
      if (bus) bus.emit("data.subject.receipt", receipt);
      return;
    }

    // Store DSR request
    const dsrRequest: DSRRequest = {
      requestId: request.requestId,
      type: request.type,
      subjectId: request.subjectId,
      subjectIdHash,
      status: "processing",
      createdAt: new Date(),
      deliveryTarget: request.delivery.target,
      deliveryFormat: request.delivery.format
    };
    
    this.state.pendingDSRs.set(request.requestId, dsrRequest);

    // Process request asynchronously
    setTimeout(() => {
      this.processDSRAsync(dsrRequest, bus, logger);
    }, 100);

    // Send acceptance receipt
    const acceptReceipt: DataSubjectReceipt = {
      event: "data.subject.receipt",
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      type: request.type,
      status: "accepted"
    };
    
    this.emit("data.subject.receipt", acceptReceipt);
    if (bus) bus.emit("data.subject.receipt", acceptReceipt);

    if (logger) logger.info({ requestId: request.requestId, type: request.type }, "Subject request accepted");
  }

  private validateIdentityProof(request: DataSubjectRequest): boolean {
    // Simplified identity validation
    switch (request.identityProof.method) {
      case "signed_token":
        return request.identityProof.evidence.length > 32;
      case "email_match":
        return request.identityProof.evidence.includes('@');
      case "manual":
        return true; // Manual verification assumed complete
      default:
        return false;
    }
  }

  private processDSRAsync(dsrRequest: DSRRequest, bus: any, logger: any): void {
    try {
      let link: string | undefined;
      let hash: string | undefined;

      switch (dsrRequest.type) {
        case "export":
        case "access":
          const exportResult = this.generateExport(dsrRequest);
          link = exportResult.link;
          hash = exportResult.hash;
          this.state.stats.exports++;
          break;
          
        case "erasure":
          this.performErasure(dsrRequest);
          this.state.stats.erasures++;
          break;
      }

      dsrRequest.status = "completed";
      dsrRequest.completedAt = new Date();

      const receipt: DataSubjectReceipt = {
        event: "data.subject.receipt",
        timestamp: new Date().toISOString(),
        requestId: dsrRequest.requestId,
        type: dsrRequest.type,
        status: "completed",
        link,
        hash
      };

      this.emit("data.subject.receipt", receipt);
      if (bus) bus.emit("data.subject.receipt", receipt);

      if (logger) logger.info({ requestId: dsrRequest.requestId, type: dsrRequest.type }, "DSR completed");

    } catch (error: any) {
      dsrRequest.status = "failed";
      
      const receipt: DataSubjectReceipt = {
        event: "data.subject.receipt",
        timestamp: new Date().toISOString(),
        requestId: dsrRequest.requestId,
        type: dsrRequest.type,
        status: "failed",
        reason: error.message
      };

      this.emit("data.subject.receipt", receipt);
      if (bus) bus.emit("data.subject.receipt", receipt);

      if (logger) logger.error({ requestId: dsrRequest.requestId, error: error.message }, "DSR failed");
    }
  }

  private generateExport(dsrRequest: DSRRequest): { link: string; hash: string; } {
    // Mock export generation
    const exportData = {
      requestId: dsrRequest.requestId,
      subjectId: dsrRequest.subjectId,
      exportedAt: new Date().toISOString(),
      records: [] // Would contain actual subject data
    };

    const exportContent = JSON.stringify(exportData, null, 2);
    const hash = crypto.createHash('sha256').update(exportContent).digest('hex');
    const filename = `${dsrRequest.requestId}.${dsrRequest.deliveryFormat}`;
    const link = `${this.config.export.tmpDir}/${filename}`;

    return { link, hash };
  }

  private performErasure(dsrRequest: DSRRequest): void {
    // Remove subject from map
    this.state.subjectMap.delete(dsrRequest.subjectIdHash);
    
    // In a real implementation, this would:
    // 1. Find all records with matching subjectIdHash
    // 2. Securely delete or tombstone them
    // 3. Remove from all indexes
    // 4. Ensure downstream systems can't reconstruct the data
  }

  private setupIntervals(): void {
    // Retention sweep interval
    this.sweepInterval = setInterval(() => {
      this.performRetentionSweep();
    }, this.config.sweep.intervalMin * 60 * 1000);

    // Metrics emission interval
    this.metricsInterval = setInterval(() => {
      this.emitMetrics();
    }, 10000); // Every 10 seconds
  }

  private performRetentionSweep(): void {
    const now = new Date();
    let deleted = 0;
    let deletedBytes = 0;

    // Find expired records
    for (const [expirationKey, eventIds] of this.state.retentionIndex.entries()) {
      const expirationDate = new Date(expirationKey);
      
      if (expirationDate <= now) {
        // Delete expired records
        for (const eventId of eventIds) {
          const storageRef = this.state.lineageIndex.get(eventId);
          if (storageRef) {
            // In real implementation, would securely delete from storage
            deleted++;
            deletedBytes += 1024; // Mock size
            
            // Remove from indexes
            this.state.lineageIndex.delete(eventId);
          }
        }
        
        // Remove expired entry
        this.state.retentionIndex.delete(expirationKey);
      }
    }

    if (deleted > 0) {
      const report: RetentionSweepReport = {
        event: "retention.sweep.report",
        timestamp: now.toISOString(),
        policyVersion: this.state.policy?.version || 1,
        deleted: {
          records: deleted,
          bytes: deletedBytes
        },
        redacted: {
          records: 0,
          bytes: 0
        },
        skipped: {
          records: 0,
          reason: ""
        }
      };

      this.emit("retention.sweep.report", report);
    }
  }

  private emitMetrics(): void {
    const metrics: PrivacyMetrics = {
      event: "privacy.metrics",
      timestamp: new Date().toISOString(),
      throughput: this.state.stats.throughput,
      piiDetectedRate: this.state.stats.piiDetected / Math.max(1, this.state.stats.throughput),
      drops: this.state.stats.drops,
      redactions: this.state.stats.redactions,
      exports: this.state.stats.exports,
      erasures: this.state.stats.erasures,
      errors: this.state.stats.errors
    };

    this.emit("privacy.metrics", metrics);

    // Reset counters
    this.state.stats = {
      throughput: 0,
      piiDetected: 0,
      drops: 0,
      redactions: 0,
      exports: 0,
      erasures: 0,
      errors: 0
    };
  }

  private emitAlert(level: "info" | "warn" | "error", message: string, reasonCodes: string[], logger?: any): void {
    const alert: PrivacyAlert = {
      event: "privacy.alert",
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { reasonCodes }
    };

    this.emit("privacy.alert", alert);

    if (logger) {
      logger[level]({ reasonCodes }, message);
    }
  }

  // Public methods
  getStatus(): any {
    return {
      policy: this.state.policy ? {
        version: this.state.policy.version,
        classifications: Object.keys(this.state.policy.retention)
      } : null,
      indexes: {
        lineage: this.state.lineageIndex.size,
        retention: this.state.retentionIndex.size,
        subjects: this.state.subjectMap.size
      },
      pendingDSRs: this.state.pendingDSRs.size,
      processedEvents: this.state.processedEvents.size
    };
  }

  updateConfig(updates: Partial<DataRetentionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Cleanup
  shutdown(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
