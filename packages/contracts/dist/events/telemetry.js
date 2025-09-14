import { z } from "zod";
export const TimestampSchema = z.string().datetime();
export const TelemetryMetricsSchema = z.object({
    event: z.literal("telemetry.metrics"),
    timestamp: TimestampSchema,
    module: z.string().min(1),
    metrics: z.record(z.string(), z.number().finite()),
    labels: z.record(z.string(), z.string()).optional()
}).strict();
export const TelemetryAnomalySignalSchema = z.object({
    event: z.literal("telemetry.anomaly.signal"),
    timestamp: TimestampSchema,
    kind: z.enum(["spike", "drop", "drift", "stuck"]),
    value: z.number().finite(),
    baseline: z.number().finite(),
    score: z.number().min(0).max(1),
    labels: z.record(z.string(), z.string()).optional()
}).strict();
export const TelemetrySloStatusSchema = z.object({
    event: z.literal("telemetry.slo.status"),
    timestamp: TimestampSchema,
    slo: z.string().min(1),
    status: z.enum(["ok", "at_risk", "breach"]),
    errorBudgetRemaining: z.number().min(0).max(1),
    window: z.enum(["1h", "6h", "24h", "7d"])
}).strict();
export const TelemetryRollupBatchSchema = z.object({
    event: z.literal("telemetry.rollup.batch"),
    timestamp: TimestampSchema,
    resolution: z.enum(["1m", "5m", "1h"]),
    series: z.array(z.object({
        name: z.string().min(1),
        points: z.array(z.tuple([z.number().finite(), z.number().finite()]))
    })).min(1)
}).strict();
//# sourceMappingURL=telemetry.js.map