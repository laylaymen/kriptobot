import type { ModulePermission, SecurityGuardConfig } from './securityTypes.js';
import { RuntimeSecurityGuards } from './runtimeGuards.js';

/**
 * Permission boundary enforcer that controls resource access across modules.
 * Implements defense-in-depth security by creating isolated execution contexts.
 */
export class PermissionBoundaryEnforcer {
  private guards: RuntimeSecurityGuards;
  private resourceAccessMap: Map<string, Set<string>> = new Map();
  private moduleContext: Map<string, ModuleExecutionContext> = new Map();

  constructor(config: SecurityGuardConfig) {
    this.guards = new RuntimeSecurityGuards(config);
    this.initializeResourceBoundaries();
  }

  /**
   * Initialize resource access boundaries for different module types
   */
  private initializeResourceBoundaries(): void {
    // Define which resources each module type can access
    const boundaries = [
      { 
        modules: ['dataFetcher', 'newsFetcher'], 
        resources: ['network.external', 'cache.read', 'cache.write', 'logs.write'] 
      },
      { 
        modules: ['sendTelegram', 'notificationManager'], 
        resources: ['network.telegram', 'logs.write'] 
      },
      { 
        modules: ['logger', 'auditLogger'], 
        resources: ['filesystem.logs', 'logs.write', 'logs.read'] 
      },
      { 
        modules: ['config', 'configLoader'], 
        resources: ['filesystem.config', 'logs.write'] 
      },
      { 
        modules: ['grafikBeyni', 'strategiesManager'], 
        resources: ['cache.read', 'logs.write', 'calculations.execute'] 
      },
      { 
        modules: ['envSecure', 'secretsManager'], 
        resources: ['filesystem.secrets', 'crypto.encrypt', 'crypto.decrypt', 'logs.write'] 
      }
    ];

    boundaries.forEach(boundary => {
      boundary.modules.forEach(module => {
        this.resourceAccessMap.set(module, new Set(boundary.resources));
      });
    });
  }

  /**
   * Create an isolated execution context for a module
   */
  createExecutionContext(module: string, parentContext?: string): ModuleExecutionContext {
    const permission = this.guards.getModulePermissions().get(module);
    const allowedResources = this.resourceAccessMap.get(module) || new Set();

    const context: ModuleExecutionContext = {
      module,
      parentContext,
      permissions: permission || {
        module,
        level: 'readonly',
        allowedOperations: ['read'],
        blockedOperations: []
      },
      allowedResources,
      startTime: Date.now(),
      resourceUsage: {
        networkCalls: 0,
        fileOperations: 0,
        memoryUsageMB: 0,
        cpuTimeMs: 0
      },
      violations: []
    };

    this.moduleContext.set(module, context);
    return context;
  }

  /**
   * Check if a module can access a specific resource
   */
  canAccessResource(module: string, resource: string, operation: string): boolean {
    const context = this.moduleContext.get(module);
    if (!context) {
      // Create context on-the-fly if it doesn't exist
      this.createExecutionContext(module);
      return this.canAccessResource(module, resource, operation);
    }

    // Check if resource is in allowed list
    if (!context.allowedResources.has(resource)) {
      this.recordContextViolation(context, 'resource_access_denied', {
        resource,
        operation,
        reason: 'Resource not in allowed list'
      });
      return false;
    }

    // Use runtime guards for additional permission checking
    return this.guards.checkPermission(module, operation, { resource });
  }

  /**
   * Execute an operation within a module's security boundary
   */
  async executeInBoundary<T>(
    module: string, 
    operation: string, 
    resources: string[], 
    fn: () => Promise<T>
  ): Promise<T> {
    const context = this.moduleContext.get(module) || this.createExecutionContext(module);
    
    // Check permissions for all required resources
    for (const resource of resources) {
      if (!this.canAccessResource(module, resource, operation)) {
        throw new Error(`Permission denied: ${module} cannot access ${resource} for ${operation}`);
      }
    }

    // Monitor resource usage during execution
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      const result = await fn();
      
      // Update resource usage stats
      context.resourceUsage.cpuTimeMs += Date.now() - startTime;
      context.resourceUsage.memoryUsageMB = Math.max(
        context.resourceUsage.memoryUsageMB,
        (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024
      );

      return result;
    } catch (error) {
      this.recordContextViolation(context, 'execution_error', {
        operation,
        resources,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Create a sandboxed function wrapper for a module
   */
  sandboxFunction<TArgs extends any[], TReturn>(
    module: string,
    operation: string,
    resources: string[],
    fn: (...args: TArgs) => TReturn | Promise<TReturn>
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs): Promise<TReturn> => {
      return this.executeInBoundary(module, operation, resources, async () => {
        return await fn(...args);
      });
    };
  }

  /**
   * Monitor and limit resource usage
   */
  enforceResourceLimits(module: string): boolean {
    const context = this.moduleContext.get(module);
    if (!context) return true;

    const limits = context.permissions.resourceLimits;
    if (!limits) return true;

    // Check memory limit
    if (limits.maxMemoryMB && context.resourceUsage.memoryUsageMB > limits.maxMemoryMB) {
      this.recordContextViolation(context, 'memory_limit_exceeded', {
        current: context.resourceUsage.memoryUsageMB,
        limit: limits.maxMemoryMB
      });
      return false;
    }

    // Check network connection limit
    if (limits.maxNetworkConnections && context.resourceUsage.networkCalls > limits.maxNetworkConnections) {
      this.recordContextViolation(context, 'network_limit_exceeded', {
        current: context.resourceUsage.networkCalls,
        limit: limits.maxNetworkConnections
      });
      return false;
    }

    return true;
  }

  /**
   * Record a violation in the module's execution context
   */
  private recordContextViolation(
    context: ModuleExecutionContext, 
    violationType: string, 
    details: Record<string, unknown>
  ): void {
    const violation = {
      timestamp: new Date().toISOString(),
      type: violationType,
      details,
      blocked: true
    };

    context.violations.push(violation);
    
    // Log critical violations
    console.warn(`[BOUNDARY_VIOLATION] ${context.module}: ${violationType}`, details);
  }

  /**
   * Get execution context for a module
   */
  getExecutionContext(module: string): ModuleExecutionContext | null {
    return this.moduleContext.get(module) || null;
  }

  /**
   * Get resource usage statistics
   */
  getResourceUsage(): Map<string, ModuleExecutionContext> {
    return new Map(this.moduleContext);
  }

  /**
   * Clean up finished execution contexts
   */
  cleanupContexts(maxAgeMs: number = 300000): void { // 5 minutes default
    const now = Date.now();
    for (const [module, context] of this.moduleContext.entries()) {
      if (now - context.startTime > maxAgeMs) {
        this.moduleContext.delete(module);
      }
    }
  }

  /**
   * Reset resource usage counters for a module
   */
  resetResourceUsage(module: string): void {
    const context = this.moduleContext.get(module);
    if (context) {
      context.resourceUsage = {
        networkCalls: 0,
        fileOperations: 0,
        memoryUsageMB: 0,
        cpuTimeMs: 0
      };
    }
  }
}

/**
 * Module execution context interface
 */
export interface ModuleExecutionContext {
  module: string;
  parentContext?: string;
  permissions: ModulePermission;
  allowedResources: Set<string>;
  startTime: number;
  resourceUsage: {
    networkCalls: number;
    fileOperations: number;
    memoryUsageMB: number;
    cpuTimeMs: number;
  };
  violations: Array<{
    timestamp: string;
    type: string;
    details: Record<string, unknown>;
    blocked: boolean;
  }>;
}