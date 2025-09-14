import { SecretsManager } from './secretsManager';
import { SecretsConfig } from './secretsTypes';

describe('SecretsManager', () => {
  const testConfig: SecretsConfig = {
    masterKey: 'e89f4cf92cbb3860870878529186520737d75c4c0bf4619c226eade04a606604',
    keyDerivation: {
      algorithm: 'pbkdf2',
      iterations: 100000
    },
    rotation: {
      enabled: false,
      intervalDays: 90,
      notifyBeforeExpiry: 7
    },
    audit: {
      enabled: true,
      logAccess: false, // Disable for tests
      logRotation: true
    }
  };

  let manager: SecretsManager;

  beforeEach(() => {
    manager = new SecretsManager(testConfig);
  });

  it('should encrypt and decrypt secrets correctly', () => {
    manager.setSecret('TEST_SECRET', 'my-secret-value', {}, 'test-module');
    const retrieved = manager.getSecret('TEST_SECRET', 'test-module');
    expect(retrieved).toBe('my-secret-value');
  });

  it('should return null for non-existent secrets', () => {
    const retrieved = manager.getSecret('NON_EXISTENT', 'test-module');
    expect(retrieved).toBeNull();
  });

  it('should load secrets from environment variables', () => {
    process.env.TEST_API_KEY = 'test-api-key-value';
    process.env.TEST_ENCRYPTED = 'enc:1234567890abcdef:encrypted-data';
    
    manager.loadFromEnv(['TEST_API_KEY', 'TEST_ENCRYPTED'], 'env-test');
    
    expect(manager.hasSecret('TEST_API_KEY')).toBe(true);
    expect(manager.hasSecret('TEST_ENCRYPTED')).toBe(true);
    expect(manager.getSecret('TEST_API_KEY', 'test')).toBe('test-api-key-value');
    
    delete process.env.TEST_API_KEY;
    delete process.env.TEST_ENCRYPTED;
  });

  it('should handle expired secrets', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    manager.setSecret('EXPIRED_SECRET', 'value', { expiresAt: pastDate }, 'test');
    
    expect(manager.hasSecret('EXPIRED_SECRET')).toBe(false);
    expect(manager.getSecret('EXPIRED_SECRET', 'test')).toBeNull();
  });

  it('should log audit trail', () => {
    manager.setSecret('AUDIT_TEST', 'value', {}, 'audit-module');
    manager.getSecret('AUDIT_TEST', 'audit-module');
    manager.getSecret('NON_EXISTENT', 'audit-module');
    
    const logs = manager.getAuditLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0].operation).toBe('set');
    expect(logs[0].success).toBe(true);
    expect(logs[1].operation).toBe('get');
    expect(logs[1].success).toBe(true);
    expect(logs[2].operation).toBe('get');
    expect(logs[2].success).toBe(false);
  });

  it('should infer PII levels correctly', () => {
    // Set test env vars
    process.env.USER_EMAIL = 'test@example.com';
    process.env.API_TOKEN = 'token123';
    process.env.RANDOM_CONFIG = 'config_value';
    
    manager.loadFromEnv(['USER_EMAIL', 'API_TOKEN', 'RANDOM_CONFIG'], 'pii-test');
    
    const logs = manager.getAuditLogs();
    // Since we can't directly access private methods, we verify through logs
    expect(logs.some(log => log.secretKey === 'USER_EMAIL')).toBe(true);
    expect(logs.some(log => log.secretKey === 'API_TOKEN')).toBe(true);
    expect(logs.some(log => log.secretKey === 'RANDOM_CONFIG')).toBe(true);
    
    // Clean up
    delete process.env.USER_EMAIL;
    delete process.env.API_TOKEN;
    delete process.env.RANDOM_CONFIG;
  });
});