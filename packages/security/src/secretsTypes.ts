import { z } from 'zod';

// Secret schema for type safety and validation
export const SecretSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  encrypted: z.boolean().default(false),
  lastRotated: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  scope: z.enum(['global', 'module', 'service']).default('global'),
  piiLevel: z.enum(['none', 'low', 'basic', 'strict']).default('none')
}).strict();

export type Secret = z.infer<typeof SecretSchema>;

// Secrets configuration schema
export const SecretsConfigSchema = z.object({
  masterKey: z.string().length(64), // 32-byte hex key for AES-256
  keyDerivation: z.object({
    algorithm: z.enum(['pbkdf2', 'scrypt', 'argon2']).default('pbkdf2'),
    iterations: z.number().int().min(100000).default(100000),
    salt: z.string().optional()
  }),
  rotation: z.object({
    enabled: z.boolean().default(false),
    intervalDays: z.number().int().min(1).default(90),
    notifyBeforeExpiry: z.number().int().min(1).default(7)
  }),
  audit: z.object({
    enabled: z.boolean().default(true),
    logAccess: z.boolean().default(true),
    logRotation: z.boolean().default(true)
  })
}).strict();

export type SecretsConfig = z.infer<typeof SecretsConfigSchema>;

// Secret access log schema
export const SecretAccessLogSchema = z.object({
  timestamp: z.string().datetime(),
  secretKey: z.string(),
  operation: z.enum(['get', 'set', 'rotate', 'delete']),
  module: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict();

export type SecretAccessLog = z.infer<typeof SecretAccessLogSchema>;