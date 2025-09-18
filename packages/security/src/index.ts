// Export all security components
export { SecretsManager } from './secretsManager.js';
export { RuntimeSecurityGuards } from './runtimeGuards.js';
export { PermissionBoundaryEnforcer, type ModuleExecutionContext } from './permissionBoundaries.js';

// Export types
export type {
  Secret,
  SecretsConfig,
  SecretAccessLog
} from './secretsTypes.js';

export type {
  SecurityGuardConfig,
  SecurityViolation,
  SecurityViolationLevel,
  ModulePermission,
  PermissionLevel
} from './securityTypes.js';

// Re-export for convenience
export * from './secretsTypes';
export * from './securityTypes';