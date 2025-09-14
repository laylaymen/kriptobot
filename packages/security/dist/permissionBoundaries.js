import { RuntimeSecurityGuards } from './runtimeGuards';
/**
 * Permission boundary enforcer that controls resource access across modules.
 * Implements defense-in-depth security by creating isolated execution contexts.
 */
export class PermissionBoundaryEnforcer {
    guards;
    resourceAccessMap = new Map();
    moduleContext = new Map();
    constructor(config) {
        this.guards = new RuntimeSecurityGuards(config);
        this.initializeResourceBoundaries();
    }
    /**
     * Initialize resource access boundaries for different module types
     */
    initializeResourceBoundaries() {
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
    createExecutionContext(module, parentContext) {
        const permission = this.guards.getModulePermissions().get(module);
        const allowedResources = this.resourceAccessMap.get(module) || new Set();
        const context = {
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
    canAccessResource(module, resource, operation) {
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
    async executeInBoundary(module, operation, resources, fn) {
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
            context.resourceUsage.memoryUsageMB = Math.max(context.resourceUsage.memoryUsageMB, (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024);
            return result;
        }
        catch (error) {
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
    sandboxFunction(module, operation, resources, fn) {
        return async (...args) => {
            return this.executeInBoundary(module, operation, resources, async () => {
                return await fn(...args);
            });
        };
    }
    /**
     * Monitor and limit resource usage
     */
    enforceResourceLimits(module) {
        const context = this.moduleContext.get(module);
        if (!context)
            return true;
        const limits = context.permissions.resourceLimits;
        if (!limits)
            return true;
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
    recordContextViolation(context, violationType, details) {
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
    getExecutionContext(module) {
        return this.moduleContext.get(module) || null;
    }
    /**
     * Get resource usage statistics
     */
    getResourceUsage() {
        return new Map(this.moduleContext);
    }
    /**
     * Clean up finished execution contexts
     */
    cleanupContexts(maxAgeMs = 300000) {
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
    resetResourceUsage(module) {
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
