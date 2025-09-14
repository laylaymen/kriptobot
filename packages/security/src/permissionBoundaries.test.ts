import { PermissionBoundaryEnforcer, ModuleExecutionContext } from './permissionBoundaries';
import { SecurityGuardConfig } from './securityTypes';
import { RuntimeSecurityGuards } from './runtimeGuards';

describe('PermissionBoundaryEnforcer', () => {
  const testConfig: SecurityGuardConfig = {
    enabled: true,
    enforceMode: true,
    maxApiCallsPerMinute: 100,
    allowedModules: [],
    blockedOperations: [],
    privilegeEscalationDetection: true,
    fileSystemAccessControl: true,
    networkAccessControl: true,
    processExecution: {
      allowed: false,
      whitelist: []
    }
  };

  let enforcer: PermissionBoundaryEnforcer;

  beforeEach(() => {
    enforcer = new PermissionBoundaryEnforcer(testConfig);
  });

  describe('Execution Context Management', () => {
    it('should create execution context for modules', () => {
      const context = enforcer.createExecutionContext('dataFetcher');
      
      expect(context.module).toBe('dataFetcher');
      expect(context.startTime).toBeLessThanOrEqual(Date.now());
      expect(context.allowedResources.has('network.external')).toBe(true);
      expect(context.allowedResources.has('cache.read')).toBe(true);
    });

    it('should retrieve existing execution context', () => {
      const originalContext = enforcer.createExecutionContext('testModule');
      const retrievedContext = enforcer.getExecutionContext('testModule');
      
      expect(retrievedContext).toBe(originalContext);
    });
  });

  describe('Resource Access Control', () => {
    it('should allow access to permitted resources', () => {
      enforcer.createExecutionContext('dataFetcher');
      const canAccess = enforcer.canAccessResource('dataFetcher', 'network.external', 'fetch');
      
      expect(canAccess).toBe(true);
    });

    it('should deny access to non-permitted resources', () => {
      enforcer.createExecutionContext('dataFetcher');
      const canAccess = enforcer.canAccessResource('dataFetcher', 'filesystem.secrets', 'read');
      
      expect(canAccess).toBe(false);
    });

    it('should allow logger modules to access log resources', () => {
      const context = enforcer.createExecutionContext('logger');
      
      // Set the module permission directly in the guards to avoid issue
      const guards = (enforcer as any).guards as RuntimeSecurityGuards;
      guards.setModulePermission({
        module: 'logger',
        level: 'readonly',
        allowedOperations: ['log', 'read', 'write'],
        blockedOperations: ['delete', 'modify']
      });
      
      const canAccessLogs = enforcer.canAccessResource('logger', 'filesystem.logs', 'write');
      const canAccessSecrets = enforcer.canAccessResource('logger', 'filesystem.secrets', 'read');
      
      expect(canAccessLogs).toBe(true);
      expect(canAccessSecrets).toBe(false);
    });
  });

  describe('Sandboxed Execution', () => {
    it('should execute functions within security boundaries', async () => {
      const testFunction = async () => {
        return 'success';
      };

      const result = await enforcer.executeInBoundary(
        'dataFetcher',
        'fetch',
        ['network.external'],
        testFunction
      );

      expect(result).toBe('success');
    });

    it('should reject execution without proper permissions', async () => {
      const testFunction = async () => {
        return 'should not execute';
      };

      await expect(
        enforcer.executeInBoundary(
          'dataFetcher',
          'decrypt',
          ['filesystem.secrets'],
          testFunction
        )
      ).rejects.toThrow('Permission denied');
    });

    it('should track resource usage during execution', async () => {
      const testFunction = async () => {
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'done';
      };

      await enforcer.executeInBoundary(
        'dataFetcher',
        'fetch',
        ['network.external'],
        testFunction
      );

      const context = enforcer.getExecutionContext('dataFetcher');
      expect(context?.resourceUsage.cpuTimeMs).toBeGreaterThan(0);
    });
  });

  describe('Sandboxed Function Wrapper', () => {
    it('should create sandboxed function wrappers', async () => {
      const originalFunction = (x: number, y: number) => x + y;
      
      // Set proper permissions for dataFetcher to access cache.read
      const guards = (enforcer as any).guards as RuntimeSecurityGuards;
      guards.setModulePermission({
        module: 'dataFetcher',
        level: 'standard',
        allowedOperations: ['calculate', 'cache', 'read'],
        blockedOperations: []
      });
      
      const sandboxed = enforcer.sandboxFunction(
        'dataFetcher',
        'calculate',
        ['cache.read'],
        originalFunction
      );

      const result = await sandboxed(5, 3);
      expect(result).toBe(8);
    });

    it('should reject sandboxed functions with insufficient permissions', async () => {
      const unauthorizedFunction = () => 'accessing secrets';
      
      const sandboxed = enforcer.sandboxFunction(
        'dataFetcher',
        'access_secrets',
        ['filesystem.secrets'],
        unauthorizedFunction
      );

      await expect(sandboxed()).rejects.toThrow('Permission denied');
    });
  });

  describe('Resource Usage Monitoring', () => {
    it('should track and enforce memory limits', () => {
      const context = enforcer.createExecutionContext('testModule');
      
      // Simulate memory usage
      context.resourceUsage.memoryUsageMB = 150;
      context.permissions.resourceLimits = { maxMemoryMB: 100 };
      
      const withinLimits = enforcer.enforceResourceLimits('testModule');
      expect(withinLimits).toBe(false);
      expect(context.violations).toHaveLength(1);
      expect(context.violations[0].type).toBe('memory_limit_exceeded');
    });

    it('should track and enforce network connection limits', () => {
      const context = enforcer.createExecutionContext('testModule');
      
      // Simulate network usage
      context.resourceUsage.networkCalls = 15;
      context.permissions.resourceLimits = { maxNetworkConnections: 10 };
      
      const withinLimits = enforcer.enforceResourceLimits('testModule');
      expect(withinLimits).toBe(false);
      expect(context.violations).toHaveLength(1);
      expect(context.violations[0].type).toBe('network_limit_exceeded');
    });

    it('should reset resource usage counters', () => {
      const context = enforcer.createExecutionContext('testModule');
      context.resourceUsage.networkCalls = 10;
      context.resourceUsage.memoryUsageMB = 50;
      
      enforcer.resetResourceUsage('testModule');
      
      expect(context.resourceUsage.networkCalls).toBe(0);
      expect(context.resourceUsage.memoryUsageMB).toBe(0);
    });
  });

  describe('Context Cleanup', () => {
    it('should clean up old execution contexts', () => {
      const context = enforcer.createExecutionContext('oldModule');
      context.startTime = Date.now() - 400000; // 6+ minutes ago
      
      enforcer.cleanupContexts(300000); // 5 minute threshold
      
      const retrievedContext = enforcer.getExecutionContext('oldModule');
      expect(retrievedContext).toBeNull();
    });

    it('should keep recent execution contexts', () => {
      const context = enforcer.createExecutionContext('recentModule');
      
      enforcer.cleanupContexts(300000); // 5 minute threshold
      
      const retrievedContext = enforcer.getExecutionContext('recentModule');
      expect(retrievedContext).toBe(context);
    });
  });

  describe('Resource Usage Statistics', () => {
    it('should provide resource usage statistics', () => {
      enforcer.createExecutionContext('module1');
      enforcer.createExecutionContext('module2');
      
      const stats = enforcer.getResourceUsage();
      expect(stats.size).toBe(2);
      expect(stats.has('module1')).toBe(true);
      expect(stats.has('module2')).toBe(true);
    });
  });
});