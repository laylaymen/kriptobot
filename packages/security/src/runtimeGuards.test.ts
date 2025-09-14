import { RuntimeSecurityGuards } from './runtimeGuards';
import { SecurityGuardConfig } from './securityTypes';

describe('RuntimeSecurityGuards', () => {
  const testConfig: SecurityGuardConfig = {
    enabled: true,
    enforceMode: true,
    maxApiCallsPerMinute: 5, // Low limit for testing
    allowedModules: ['test-module'],
    blockedOperations: ['dangerous-operation'],
    privilegeEscalationDetection: true,
    fileSystemAccessControl: true,
    networkAccessControl: true,
    processExecution: {
      allowed: false,
      whitelist: []
    }
  };

  let guards: RuntimeSecurityGuards;

  beforeEach(() => {
    guards = new RuntimeSecurityGuards(testConfig);
  });

  describe('Permission Checking', () => {
    it('should allow operations for registered modules', () => {
      const result = guards.checkPermission('dataFetcher', 'fetch');
      expect(result).toBe(true);
    });

    it('should block operations for unregistered modules', () => {
      const result = guards.checkPermission('unknown-module', 'dangerous-op');
      expect(result).toBe(false);
      
      const violations = guards.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('unauthorized_access');
    });

    it('should block explicitly blocked operations', () => {
      const result = guards.checkPermission('logger', 'delete');
      expect(result).toBe(false);
      
      const violations = guards.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('blocked_operation');
    });
  });

  describe('Rate Limiting', () => {
    it('should allow operations within rate limit', () => {
      for (let i = 0; i < 5; i++) {
        const result = guards.checkRateLimit('test-module', 'test-op');
        expect(result).toBe(true);
      }
    });

    it('should block operations exceeding rate limit', () => {
      // Exceed the limit (5 calls per minute)
      for (let i = 0; i < 6; i++) {
        guards.checkRateLimit('test-module', 'test-op');
      }
      
      const violations = guards.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('rate_limit_exceeded');
    });
  });

  describe('Privilege Escalation Detection', () => {
    it('should allow same-level access', () => {
      const result = guards.detectPrivilegeEscalation('test-module', 'standard', 'standard');
      expect(result).toBe(true);
    });

    it('should allow downgrade', () => {
      const result = guards.detectPrivilegeEscalation('test-module', 'readonly', 'standard');
      expect(result).toBe(true);
    });

    it('should block privilege escalation', () => {
      const result = guards.detectPrivilegeEscalation('test-module', 'admin', 'readonly');
      expect(result).toBe(false);
      
      const violations = guards.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('privilege_escalation');
    });
  });

  describe('File System Access Control', () => {
    it('should allow normal file access', () => {
      const result = guards.checkFileAccess('test-module', 'read', '/tmp/safe-file.txt');
      expect(result).toBe(true);
    });

    it('should block writes to sensitive files', () => {
      const result = guards.checkFileAccess('test-module', 'write', '/etc/passwd');
      expect(result).toBe(false);
      
      const violations = guards.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('suspicious_file_access');
    });

    it('should allow reads to sensitive files', () => {
      const result = guards.checkFileAccess('test-module', 'read', '/etc/passwd');
      expect(result).toBe(true);
    });
  });

  describe('Network Access Control', () => {
    it('should allow external network access for standard modules', () => {
      guards.setModulePermission({
        module: 'test-module',
        level: 'standard',
        allowedOperations: ['*'],
        blockedOperations: []
      });
      
      const result = guards.checkNetworkAccess('test-module', 'https://api.external.com/data');
      expect(result).toBe(true);
    });

    it('should block localhost access for readonly modules', () => {
      guards.setModulePermission({
        module: 'readonly-module',
        level: 'readonly',
        allowedOperations: ['read'],
        blockedOperations: []
      });
      
      const result = guards.checkNetworkAccess('readonly-module', 'http://localhost:3000/admin');
      expect(result).toBe(false);
      
      const violations = guards.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('unsafe_network_request');
    });

    it('should handle invalid URLs gracefully', () => {
      const result = guards.checkNetworkAccess('test-module', 'not-a-valid-url');
      expect(result).toBe(false);
      
      const violations = guards.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('unsafe_network_request');
    });
  });

  describe('Violation Management', () => {
    it('should record and retrieve violations', () => {
      guards.checkPermission('unknown-module', 'dangerous-op');
      guards.detectPrivilegeEscalation('test-module', 'admin', 'readonly');
      
      const allViolations = guards.getViolations();
      expect(allViolations).toHaveLength(2);
      
      const criticalViolations = guards.getViolations('critical');
      expect(criticalViolations).toHaveLength(1);
      expect(criticalViolations[0].type).toBe('privilege_escalation');
    });

    it('should clear violations', () => {
      guards.checkPermission('unknown-module', 'dangerous-op');
      expect(guards.getViolations()).toHaveLength(1);
      
      guards.clearViolations();
      expect(guards.getViolations()).toHaveLength(0);
    });
  });
});