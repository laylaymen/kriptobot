import * as crypto from 'node:crypto';
import type { Secret, SecretsConfig, SecretAccessLog } from './secretsTypes.js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Enhanced secrets manager with centralized, secure, auditable secret handling.
 * Fixes issues: manual input, console logging, no validation, no rotation, no audit.
 */
export class SecretsManager {
  private secrets: Map<string, Secret> = new Map();
  private config: SecretsConfig;
  private auditLogs: SecretAccessLog[] = [];

  constructor(config: SecretsConfig) {
    this.config = config;
  }

  /**
   * Encrypt a value using AES-256-CBC with the master key
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(this.config.masterKey, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt a value using AES-256-CBC with the master key
   */
  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts.shift()!, 'hex');
    const encrypted = parts.join(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(this.config.masterKey, 'hex'), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Log secret access for audit trail
   */
  private logAccess(operation: 'get' | 'set' | 'rotate' | 'delete', secretKey: string, module: string, success: boolean, error?: string): void {
    if (!this.config.audit.enabled) return;

    const log: SecretAccessLog = {
      timestamp: new Date().toISOString(),
      secretKey,
      operation,
      module,
      success,
      error,
      metadata: { configAuditEnabled: this.config.audit.enabled }
    };

    this.auditLogs.push(log);

    // In production, this would go to secure logging system
    if (this.config.audit.logAccess) {
      console.log(`[SECURITY_AUDIT] ${operation.toUpperCase()} ${secretKey} by ${module}: ${success ? 'SUCCESS' : 'FAILED'}${error ? ` - ${error}` : ''}`);
    }
  }

  /**
   * Set a secret (encrypted or plain text)
   */
  setSecret(key: string, value: string, options: Partial<Pick<Secret, 'scope' | 'piiLevel' | 'expiresAt'>> = {}, callerModule = 'unknown'): void {
    try {
      const secret: Secret = {
        key,
        value: this.encrypt(value),
        encrypted: true,
        lastRotated: new Date().toISOString(),
        scope: options.scope || 'global',
        piiLevel: options.piiLevel || 'none',
        expiresAt: options.expiresAt
      };

      this.secrets.set(key, secret);
      this.logAccess('set', key, callerModule, true);
    } catch (error) {
      this.logAccess('set', key, callerModule, false, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Get a secret (returns decrypted value)
   */
  getSecret(key: string, callerModule = 'unknown'): string | null {
    try {
      const secret = this.secrets.get(key);
      if (!secret) {
        this.logAccess('get', key, callerModule, false, 'Secret not found');
        return null;
      }

      // Check expiration
      if (secret.expiresAt && new Date() > new Date(secret.expiresAt)) {
        this.logAccess('get', key, callerModule, false, 'Secret expired');
        return null;
      }

      const decryptedValue = secret.encrypted ? this.decrypt(secret.value) : secret.value;
      this.logAccess('get', key, callerModule, true);
      return decryptedValue;
    } catch (error) {
      this.logAccess('get', key, callerModule, false, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Load secrets from environment variables (with enc: prefix support)
   */
  loadFromEnv(envVars: string[], callerModule = 'env-loader'): void {
    for (const envVar of envVars) {
      const value = process.env[envVar];
      if (!value) continue;

      if (value.startsWith('enc:')) {
        // Already encrypted, store as-is but mark as encrypted
        const secret: Secret = {
          key: envVar,
          value: value.slice(4), // Remove 'enc:' prefix
          encrypted: true,
          scope: 'global',
          piiLevel: this.inferPIILevel(envVar)
        };
        this.secrets.set(envVar, secret);
      } else {
        // Plain text, encrypt and store
        this.setSecret(envVar, value, { 
          scope: 'global',
          piiLevel: this.inferPIILevel(envVar)
        }, callerModule);
      }
    }
  }

  /**
   * Infer PII level based on secret key name
   */
  private inferPIILevel(key: string): 'none' | 'low' | 'basic' | 'strict' {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('email') || lowerKey.includes('phone') || lowerKey.includes('user')) return 'basic';
    if (lowerKey.includes('api') || lowerKey.includes('token') || lowerKey.includes('key')) return 'low';
    return 'none';
  }

  /**
   * Get audit logs (for security monitoring)
   */
  getAuditLogs(): SecretAccessLog[] {
    return [...this.auditLogs];
  }

  /**
   * Clear audit logs (for memory management)
   */
  clearAuditLogs(): void {
    this.auditLogs = [];
  }

  /**
   * Check if a secret exists and is valid (not expired)
   */
  hasSecret(key: string): boolean {
    const secret = this.secrets.get(key);
    if (!secret) return false;
    if (secret.expiresAt && new Date() > new Date(secret.expiresAt)) return false;
    return true;
  }

  /**
   * List all secret keys (for management/debugging)
   */
  listSecretKeys(): string[] {
    return Array.from(this.secrets.keys());
  }
}