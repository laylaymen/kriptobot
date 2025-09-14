import { z } from 'zod';
export const MetricEventSchema = z.object({
    timestamp: z.string().datetime(),
    module: z.string(),
    name: z.string(),
    value: z.number(),
    labels: z.record(z.string(), z.string()).optional(),
    meta: z.record(z.string(), z.unknown()).optional()
}).strict();
