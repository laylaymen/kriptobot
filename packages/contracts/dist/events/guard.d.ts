import { z } from "zod";
export declare const SentryGuardDirectiveSchema: z.ZodObject<{
    event: z.ZodLiteral<"sentry.guard.directive">;
    timestamp: z.ZodString;
    correlationId: z.ZodString;
    directive: z.ZodEnum<["block_all", "block_aggressive", "allow_conservative", "halt_entry", "reduce_sizes", "emergency_stop"]>;
    reason: z.ZodString;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
}, "strict", z.ZodTypeAny, {
    event: "sentry.guard.directive";
    timestamp: string;
    correlationId: string;
    directive: "block_all" | "block_aggressive" | "allow_conservative" | "halt_entry" | "reduce_sizes" | "emergency_stop";
    reason: string;
    severity: "low" | "medium" | "high" | "critical";
}, {
    event: "sentry.guard.directive";
    timestamp: string;
    correlationId: string;
    directive: "block_all" | "block_aggressive" | "allow_conservative" | "halt_entry" | "reduce_sizes" | "emergency_stop";
    reason: string;
    severity: "low" | "medium" | "high" | "critical";
}>;
export declare const SentryFailoverRecommendationSchema: z.ZodObject<{
    event: z.ZodLiteral<"sentry.failover.recommendation">;
    timestamp: z.ZodString;
    planId: z.ZodString;
    from: z.ZodString;
    to: z.ZodString;
    reason: z.ZodString;
    etaSec: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    event: "sentry.failover.recommendation";
    timestamp: string;
    reason: string;
    planId: string;
    from: string;
    to: string;
    etaSec: number;
}, {
    event: "sentry.failover.recommendation";
    timestamp: string;
    reason: string;
    planId: string;
    from: string;
    to: string;
    etaSec: number;
}>;
export declare const LatencySlipGuardDirectiveSchema: z.ZodObject<{
    event: z.ZodLiteral<"latency_slip.guard.directive">;
    timestamp: z.ZodString;
    correlationId: z.ZodString;
    placeLatencyMsP95: z.ZodNumber;
    firstFillLatencyMsP95: z.ZodNumber;
    slipBpP95: z.ZodNumber;
    mode: z.ZodEnum<["observe", "soft_guard", "hard_guard"]>;
    action: z.ZodEnum<["no_change", "widen_tpsl", "halt_entry", "reduce_size"]>;
}, "strict", z.ZodTypeAny, {
    event: "latency_slip.guard.directive";
    timestamp: string;
    correlationId: string;
    placeLatencyMsP95: number;
    firstFillLatencyMsP95: number;
    slipBpP95: number;
    mode: "observe" | "soft_guard" | "hard_guard";
    action: "halt_entry" | "no_change" | "widen_tpsl" | "reduce_size";
}, {
    event: "latency_slip.guard.directive";
    timestamp: string;
    correlationId: string;
    placeLatencyMsP95: number;
    firstFillLatencyMsP95: number;
    slipBpP95: number;
    mode: "observe" | "soft_guard" | "hard_guard";
    action: "halt_entry" | "no_change" | "widen_tpsl" | "reduce_size";
}>;
export declare const StreamIntegrityAlertSchema: z.ZodObject<{
    event: z.ZodLiteral<"stream.integrity.alert">;
    timestamp: z.ZodString;
    kind: z.ZodEnum<["gap", "stale", "duplicate", "out_of_order"]>;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
    details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strict", z.ZodTypeAny, {
    event: "stream.integrity.alert";
    timestamp: string;
    severity: "low" | "medium" | "high" | "critical";
    kind: "gap" | "stale" | "duplicate" | "out_of_order";
    details?: Record<string, any> | undefined;
}, {
    event: "stream.integrity.alert";
    timestamp: string;
    severity: "low" | "medium" | "high" | "critical";
    kind: "gap" | "stale" | "duplicate" | "out_of_order";
    details?: Record<string, any> | undefined;
}>;
export declare const OrderflowPacingPlanSchema: z.ZodObject<{
    event: z.ZodLiteral<"orderflow.pacing.plan">;
    timestamp: z.ZodString;
    maxInFlight: z.ZodNumber;
    deferNew: z.ZodBoolean;
    dropNew: z.ZodOptional<z.ZodBoolean>;
    reason: z.ZodString;
}, "strict", z.ZodTypeAny, {
    event: "orderflow.pacing.plan";
    timestamp: string;
    reason: string;
    maxInFlight: number;
    deferNew: boolean;
    dropNew?: boolean | undefined;
}, {
    event: "orderflow.pacing.plan";
    timestamp: string;
    reason: string;
    maxInFlight: number;
    deferNew: boolean;
    dropNew?: boolean | undefined;
}>;
export type SentryGuardDirective = z.infer<typeof SentryGuardDirectiveSchema>;
export type SentryFailoverRecommendation = z.infer<typeof SentryFailoverRecommendationSchema>;
export type LatencySlipGuardDirective = z.infer<typeof LatencySlipGuardDirectiveSchema>;
export type StreamIntegrityAlert = z.infer<typeof StreamIntegrityAlertSchema>;
export type OrderflowPacingPlan = z.infer<typeof OrderflowPacingPlanSchema>;
//# sourceMappingURL=guard.d.ts.map