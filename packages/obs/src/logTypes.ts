import { z } from 'zod';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);

export const LogEventSchema = z.object({
  timestamp: z.string().datetime(),
  level: LogLevelSchema,
  message: z.string(),
  module: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
  pii: z.enum(['none', 'low', 'basic', 'strict']).default('none'),
  meta: z.record(z.string(), z.unknown()).optional()
}).strict();

export type LogEvent = z.infer<typeof LogEventSchema>;
