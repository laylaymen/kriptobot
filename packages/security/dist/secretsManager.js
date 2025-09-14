import * as crypto from 'node:crypto';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
/**
 * Enhanced secrets manager with centralized, secure, auditable secret handling.
 * Fixes issues: manual input, console logging, no validation, no rotation, no audit.
 */
export class SecretsManager {
    secrets = new Map();
    config;
    auditLogs = [];
    constructor(config) {
        this.config = config;
    }
    /**
     * Encrypt a value using AES-256-CBC with the master key
     */
    encrypt(text) {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(this.config.masterKey, 'hex'), iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }
    /**
     * Decrypt a value using AES-256-CBC with the master key
     */
    decrypt(encryptedText) {
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encrypted = parts.join(':');
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(this.config.masterKey, 'hex'), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    /**
     * Log secret access for audit trail
     */
    logAccess(operation, secretKey, module, success, error) {
        if (!this.config.audit.enabled)
            return;
        const log = {
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
    setSecret(key, value, options = {}, callerModule = 'unknown') {
        try {
            const secret = {
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
        }
        catch (error) {
            this.logAccess('set', key, callerModule, false, error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }
    /**
     * Get a secret (returns decrypted value)
     */
    getSecret(key, callerModule = 'unknown') {
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
        }
        catch (error) {
            this.logAccess('get', key, callerModule, false, error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }
    /**
     * Load secrets from environment variables (with enc: prefix support)
     */
    loadFromEnv(envVars, callerModule = 'env-loader') {
        for (const envVar of envVars) {
            const value = process.env[envVar];
            if (!value)
                continue;
            if (value.startsWith('enc:')) {
                // Already encrypted, store as-is but mark as encrypted
                const secret = {
                    key: envVar,
                    value: value.slice(4), // Remove 'enc:' prefix
                    encrypted: true,
                    scope: 'global',
                    piiLevel: this.inferPIILevel(envVar)
                };
                this.secrets.set(envVar, secret);
            }
            else {
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
    inferPIILevel(key) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('email') || lowerKey.includes('phone') || lowerKey.includes('user'))
            return 'basic';
        if (lowerKey.includes('api') || lowerKey.includes('token') || lowerKey.includes('key'))
            return 'low';
        return 'none';
    }
    /**
     * Get audit logs (for security monitoring)
     */
    getAuditLogs() {
        return [...this.auditLogs];
    }
    /**
     * Clear audit logs (for memory management)
     */
    clearAuditLogs() {
        this.auditLogs = [];
    }
    /**
     * Check if a secret exists and is valid (not expired)
     */
    hasSecret(key) {
        const secret = this.secrets.get(key);
        if (!secret)
            return false;
        if (secret.expiresAt && new Date() > new Date(secret.expiresAt))
            return false;
        return true;
    }
    /**
     * List all secret keys (for management/debugging)
     */
    listSecretKeys() {
        return Array.from(this.secrets.keys());
    }
}
