import { z } from "zod";
export declare const TimestampSchema: z.ZodString;
export declare const TelemetryMetricsSchema: z.ZodObject<{
    event: z.ZodLiteral<"telemetry.metrics">;
    timestamp: z.ZodString;
    module: z.ZodString;
    metrics: z.ZodRecord<z.ZodString, z.ZodNumber>;
    labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strict", z.ZodTypeAny, {
    event: "telemetry.metrics";
    timestamp: string;
    module: string;
    metrics: Record<string, number>;
    labels?: Record<string, string> | undefined;
}, {
    event: "telemetry.metrics";
    timestamp: string;
    module: string;
    metrics: Record<string, number>;
    labels?: Record<string, string> | undefined;
}>;
export declare const TelemetryAnomalySignalSchema: z.ZodObject<{
    event: z.ZodLiteral<"telemetry.anomaly.signal">;
    timestamp: z.ZodString;
    kind: z.ZodEnum<["spike", "drop", "drift", "stuck"]>;
    value: z.ZodNumber;
    baseline: z.ZodNumber;
    score: z.ZodNumber;
    labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strict", z.ZodTypeAny, {
    event: "telemetry.anomaly.signal";
    value: number;
    timestamp: string;
    kind: "spike" | "drop" | "drift" | "stuck";
    baseline: number;
    score: number;
    labels?: Record<string, string> | undefined;
}, {
    event: "telemetry.anomaly.signal";
    value: number;
    timestamp: string;
    kind: "spike" | "drop" | "drift" | "stuck";
    baseline: number;
    score: number;
    labels?: Record<string, string> | undefined;
}>;
export declare const TelemetrySloStatusSchema: z.ZodObject<{
    event: z.ZodLiteral<"telemetry.slo.status">;
    timestamp: z.ZodString;
    slo: z.ZodString;
    status: z.ZodEnum<["ok", "at_risk", "breach"]>;
    errorBudgetRemaining: z.ZodNumber;
    window: z.ZodEnum<["1h", "6h", "24h", "7d"]>;
}, "strict", z.ZodTypeAny, {
    event: "telemetry.slo.status";
    status: "ok" | "at_risk" | "breach";
    timestamp: string;
    slo: string;
    errorBudgetRemaining: number;
    window: "1h" | "6h" | "24h" | "7d";
}, {
    event: "telemetry.slo.status";
    status: "ok" | "at_risk" | "breach";
    timestamp: string;
    slo: string;
    errorBudgetRemaining: number;
    window: "1h" | "6h" | "24h" | "7d";
}>;
export declare const TelemetryRollupBatchSchema: z.ZodObject<{
    event: z.ZodLiteral<"telemetry.rollup.batch">;
    timestamp: z.ZodString;
    resolution: z.ZodEnum<["1m", "5m", "1h"]>;
    series: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        points: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        points: [number, number][];
    }, {
        name: string;
        points: [number, number][];
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    event: "telemetry.rollup.batch";
    timestamp: string;
    resolution: "1h" | "1m" | "5m";
    series: {
        name: string;
        points: [number, number][];
    }[];
}, {
    event: "telemetry.rollup.batch";
    timestamp: string;
    resolution: "1h" | "1m" | "5m";
    series: {
        name: string;
        points: [number, number][];
    }[];
}>;
export type TelemetryMetrics = z.infer<typeof TelemetryMetricsSchema>;
export type TelemetryAnomalySignal = z.infer<typeof TelemetryAnomalySignalSchema>;
export type TelemetrySloStatus = z.infer<typeof TelemetrySloStatusSchema>;
export type TelemetryRollupBatch = z.infer<typeof TelemetryRollupBatchSchema>;
//# sourceMappingURL=telemetry.d.ts.map