import { z } from 'zod';

// Security violation levels
export const SecurityViolationLevelSchema = z.enum(['info', 'warning', 'critical', 'fatal']);
export type SecurityViolationLevel = z.infer<typeof SecurityViolationLevelSchema>;

// Security guard configuration
export const SecurityGuardConfigSchema = z.object({
  enabled: z.boolean().default(true),
  enforceMode: z.boolean().default(true), // false = log only, true = block
  maxApiCallsPerMinute: z.number().int().min(1).default(100),
  allowedModules: z.array(z.string()).default([]),
  blockedOperations: z.array(z.string()).default([]),
  privilegeEscalationDetection: z.boolean().default(true),
  fileSystemAccessControl: z.boolean().default(true),
  networkAccessControl: z.boolean().default(true),
  processExecution: z.object({
    allowed: z.boolean().default(false),
    whitelist: z.array(z.string()).default([])
  })
}).strict();

export type SecurityGuardConfig = z.infer<typeof SecurityGuardConfigSchema>;

// Security violation event
export const SecurityViolationSchema = z.object({
  timestamp: z.string().datetime(),
  level: SecurityViolationLevelSchema,
  type: z.enum([
    'unauthorized_access',
    'privilege_escalation', 
    'rate_limit_exceeded',
    'blocked_operation',
    'suspicious_file_access',
    'unsafe_network_request',
    'process_execution_attempt',
    'configuration_tampering'
  ]),
  module: z.string(),
  operation: z.string(),
  details: z.record(z.string(), z.unknown()),
  blocked: z.boolean(),
  stackTrace: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict();

export type SecurityViolation = z.infer<typeof SecurityViolationSchema>;

// Permission levels for modules
export const PermissionLevelSchema = z.enum(['readonly', 'limited', 'standard', 'elevated', 'admin']);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

// Module permission definition
export const ModulePermissionSchema = z.object({
  module: z.string(),
  level: PermissionLevelSchema,
  allowedOperations: z.array(z.string()),
  blockedOperations: z.array(z.string()).default([]),
  resourceLimits: z.object({
    maxMemoryMB: z.number().optional(),
    maxCpuPercent: z.number().optional(),
    maxFileDescriptors: z.number().optional(),
    maxNetworkConnections: z.number().optional()
  }).optional()
}).strict();

export type ModulePermission = z.infer<typeof ModulePermissionSchema>;