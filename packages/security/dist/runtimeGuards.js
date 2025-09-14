/**
 * Runtime security guards to prevent dangerous operations and privilege escalation.
 * Monitors and blocks suspicious activities in real-time.
 */
export class RuntimeSecurityGuards {
    config;
    violations = [];
    modulePermissions = new Map();
    apiCallCounts = new Map();
    constructor(config) {
        this.config = config;
        this.setupModulePermissions();
    }
    /**
     * Set up default module permissions
     */
    setupModulePermissions() {
        const defaultPermissions = [
            {
                module: 'dataFetcher',
                level: 'standard',
                allowedOperations: ['fetch', 'cache', 'validate'],
                blockedOperations: [],
                resourceLimits: { maxNetworkConnections: 10 }
            },
            {
                module: 'sendTelegram',
                level: 'limited',
                allowedOperations: ['send_message'],
                blockedOperations: [],
                resourceLimits: { maxNetworkConnections: 1 }
            },
            {
                module: 'logger',
                level: 'readonly',
                allowedOperations: ['log', 'read'],
                blockedOperations: ['delete', 'modify']
            },
            {
                module: 'config',
                level: 'readonly',
                allowedOperations: ['read', 'validate'],
                blockedOperations: []
            }
        ];
        defaultPermissions.forEach(perm => {
            this.modulePermissions.set(perm.module, perm);
        });
    }
    /**
     * Check if a module can perform an operation
     */
    checkPermission(module, operation, details = {}) {
        try {
            const permission = this.modulePermissions.get(module);
            if (!permission) {
                this.recordViolation({
                    level: 'warning',
                    type: 'unauthorized_access',
                    module,
                    operation,
                    details: { reason: 'Module not registered', ...details },
                    blocked: this.config.enforceMode
                });
                return !this.config.enforceMode;
            }
            // Check if operation is explicitly blocked
            if (permission.blockedOperations.includes(operation)) {
                this.recordViolation({
                    level: 'critical',
                    type: 'blocked_operation',
                    module,
                    operation,
                    details: { reason: 'Operation explicitly blocked', ...details },
                    blocked: true
                });
                return false;
            }
            // Check if operation is allowed
            if (!permission.allowedOperations.includes(operation) && !permission.allowedOperations.includes('*')) {
                this.recordViolation({
                    level: 'warning',
                    type: 'unauthorized_access',
                    module,
                    operation,
                    details: { reason: 'Operation not in allowed list', ...details },
                    blocked: this.config.enforceMode
                });
                return !this.config.enforceMode;
            }
            return true;
        }
        catch (error) {
            this.recordViolation({
                level: 'critical',
                type: 'configuration_tampering',
                module,
                operation,
                details: { error: error instanceof Error ? error.message : 'Unknown error', ...details },
                blocked: true
            });
            return false;
        }
    }
    /**
     * Check API rate limits
     */
    checkRateLimit(module, operation) {
        const key = `${module}:${operation}`;
        const now = Date.now();
        const minuteMs = 60 * 1000;
        let callData = this.apiCallCounts.get(key);
        if (!callData || now > callData.resetTime) {
            callData = { count: 0, resetTime: now + minuteMs };
            this.apiCallCounts.set(key, callData);
        }
        callData.count++;
        if (callData.count > this.config.maxApiCallsPerMinute) {
            this.recordViolation({
                level: 'warning',
                type: 'rate_limit_exceeded',
                module,
                operation,
                details: {
                    currentCount: callData.count,
                    limit: this.config.maxApiCallsPerMinute,
                    resetTime: new Date(callData.resetTime).toISOString()
                },
                blocked: this.config.enforceMode
            });
            return !this.config.enforceMode;
        }
        return true;
    }
    /**
     * Detect privilege escalation attempts
     */
    detectPrivilegeEscalation(module, requestedLevel, currentLevel) {
        if (!this.config.privilegeEscalationDetection)
            return true;
        const levels = ['readonly', 'limited', 'standard', 'elevated', 'admin'];
        const currentIndex = levels.indexOf(currentLevel);
        const requestedIndex = levels.indexOf(requestedLevel);
        if (requestedIndex > currentIndex) {
            this.recordViolation({
                level: 'critical',
                type: 'privilege_escalation',
                module,
                operation: 'permission_elevation',
                details: {
                    currentLevel,
                    requestedLevel,
                    escalationAttempt: true
                },
                blocked: true
            });
            return false;
        }
        return true;
    }
    /**
     * Monitor file system access
     */
    checkFileAccess(module, operation, filePath) {
        if (!this.config.fileSystemAccessControl)
            return true;
        // Define sensitive paths
        const sensitivePaths = [
            '/etc/passwd',
            '/etc/shadow',
            '/home',
            '/root',
            '.env',
            'config.json',
            'secrets.json'
        ];
        const isSensitivePath = sensitivePaths.some(path => filePath.includes(path) || filePath.endsWith(path));
        if (isSensitivePath && operation === 'write') {
            this.recordViolation({
                level: 'critical',
                type: 'suspicious_file_access',
                module,
                operation,
                details: {
                    filePath,
                    reason: 'Attempted write to sensitive file',
                    sensitivePath: true
                },
                blocked: this.config.enforceMode
            });
            return !this.config.enforceMode;
        }
        return true;
    }
    /**
     * Monitor network access
     */
    checkNetworkAccess(module, url, method = 'GET') {
        if (!this.config.networkAccessControl)
            return true;
        try {
            const urlObj = new URL(url);
            // Block localhost/internal network access from untrusted modules
            const permission = this.modulePermissions.get(module);
            if (permission && permission.level === 'readonly') {
                if (urlObj.hostname === 'localhost' || urlObj.hostname.startsWith('127.') || urlObj.hostname.startsWith('192.168.')) {
                    this.recordViolation({
                        level: 'warning',
                        type: 'unsafe_network_request',
                        module,
                        operation: 'network_request',
                        details: {
                            url,
                            method,
                            reason: 'Readonly module attempted internal network access'
                        },
                        blocked: this.config.enforceMode
                    });
                    return !this.config.enforceMode;
                }
            }
            return true;
        }
        catch (error) {
            this.recordViolation({
                level: 'warning',
                type: 'unsafe_network_request',
                module,
                operation: 'network_request',
                details: {
                    url,
                    method,
                    error: error instanceof Error ? error.message : 'Invalid URL'
                },
                blocked: this.config.enforceMode
            });
            return !this.config.enforceMode;
        }
    }
    /**
     * Record a security violation
     */
    recordViolation(violation) {
        const fullViolation = {
            timestamp: new Date().toISOString(),
            stackTrace: new Error().stack,
            ...violation
        };
        this.violations.push(fullViolation);
        // Log critical violations immediately
        if (violation.level === 'critical' || violation.level === 'fatal') {
            console.error(`[SECURITY_VIOLATION] ${violation.type.toUpperCase()}: ${violation.module} attempted ${violation.operation}`, violation.details);
        }
        // Limit violation history to prevent memory leaks
        if (this.violations.length > 1000) {
            this.violations = this.violations.slice(-500);
        }
    }
    /**
     * Get all security violations
     */
    getViolations(level) {
        if (level) {
            return this.violations.filter(v => v.level === level);
        }
        return [...this.violations];
    }
    /**
     * Clear violation history
     */
    clearViolations() {
        this.violations = [];
    }
    /**
     * Get current module permissions
     */
    getModulePermissions() {
        return new Map(this.modulePermissions);
    }
    /**
     * Update module permission
     */
    setModulePermission(permission) {
        this.modulePermissions.set(permission.module, permission);
    }
}
