import { z } from "zod";
const Timestamp = z.string().datetime();
const CorrelationId = z.string().min(1);
export const SentryGuardDirectiveSchema = z.object({
    event: z.literal("sentry.guard.directive"),
    timestamp: Timestamp,
    correlationId: CorrelationId,
    directive: z.enum(["block_all", "block_aggressive", "allow_conservative", "halt_entry", "reduce_sizes", "emergency_stop"]),
    reason: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"])
}).strict();
export const SentryFailoverRecommendationSchema = z.object({
    event: z.literal("sentry.failover.recommendation"),
    timestamp: Timestamp,
    planId: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    reason: z.string().min(1),
    etaSec: z.number().int().min(0)
}).strict();
export const LatencySlipGuardDirectiveSchema = z.object({
    event: z.literal("latency_slip.guard.directive"),
    timestamp: Timestamp,
    correlationId: CorrelationId,
    placeLatencyMsP95: z.number().finite().min(0),
    firstFillLatencyMsP95: z.number().finite().min(0),
    slipBpP95: z.number().finite(),
    mode: z.enum(["observe", "soft_guard", "hard_guard"]),
    action: z.enum(["no_change", "widen_tpsl", "halt_entry", "reduce_size"])
}).strict();
export const StreamIntegrityAlertSchema = z.object({
    event: z.literal("stream.integrity.alert"),
    timestamp: Timestamp,
    kind: z.enum(["gap", "stale", "duplicate", "out_of_order"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    details: z.record(z.string(), z.any()).optional()
}).strict();
export const OrderflowPacingPlanSchema = z.object({
    event: z.literal("orderflow.pacing.plan"),
    timestamp: Timestamp,
    maxInFlight: z.number().int().min(0),
    deferNew: z.boolean(),
    dropNew: z.boolean().optional(),
    reason: z.string().min(1)
}).strict();
//# sourceMappingURL=guard.js.map