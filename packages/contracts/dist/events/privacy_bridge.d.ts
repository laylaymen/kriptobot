import { z } from "zod";
export declare const PrivacyDataIngestSchema: z.ZodObject<{
    event: z.ZodLiteral<"privacy.data.ingest">;
    timestamp: z.ZodString;
    classification: z.ZodEnum<["NONE", "PII_LOW", "PII_BASIC", "PII_STRICT", "SECRET"]>;
    payload: z.ZodRecord<z.ZodString, z.ZodAny>;
    source: z.ZodString;
}, "strict", z.ZodTypeAny, {
    event: "privacy.data.ingest";
    timestamp: string;
    classification: "NONE" | "PII_LOW" | "PII_BASIC" | "PII_STRICT" | "SECRET";
    payload: Record<string, any>;
    source: string;
}, {
    event: "privacy.data.ingest";
    timestamp: string;
    classification: "NONE" | "PII_LOW" | "PII_BASIC" | "PII_STRICT" | "SECRET";
    payload: Record<string, any>;
    source: string;
}>;
export declare const PrivacyDataNormalizedSchema: z.ZodObject<{
    event: z.ZodLiteral<"privacy.data.normalized">;
    timestamp: z.ZodString;
    classification: z.ZodEnum<["NONE", "PII_LOW", "PII_BASIC", "PII_STRICT", "SECRET"]>;
    payload: z.ZodRecord<z.ZodString, z.ZodAny>;
    expiresAt: z.ZodString;
}, "strict", z.ZodTypeAny, {
    event: "privacy.data.normalized";
    timestamp: string;
    classification: "NONE" | "PII_LOW" | "PII_BASIC" | "PII_STRICT" | "SECRET";
    payload: Record<string, any>;
    expiresAt: string;
}, {
    event: "privacy.data.normalized";
    timestamp: string;
    classification: "NONE" | "PII_LOW" | "PII_BASIC" | "PII_STRICT" | "SECRET";
    payload: Record<string, any>;
    expiresAt: string;
}>;
export declare const PrivacyPolicyUpdateSchema: z.ZodObject<{
    event: z.ZodLiteral<"privacy.policy.update">;
    timestamp: z.ZodString;
    version: z.ZodNumber;
    defaults: z.ZodObject<{
        PII_BASIC: z.ZodString;
        PII_STRICT: z.ZodString;
        SECRET: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        PII_BASIC: string;
        PII_STRICT: string;
        SECRET: string;
    }, {
        PII_BASIC: string;
        PII_STRICT: string;
        SECRET: string;
    }>;
}, "strict", z.ZodTypeAny, {
    event: "privacy.policy.update";
    timestamp: string;
    version: number;
    defaults: {
        PII_BASIC: string;
        PII_STRICT: string;
        SECRET: string;
    };
}, {
    event: "privacy.policy.update";
    timestamp: string;
    version: number;
    defaults: {
        PII_BASIC: string;
        PII_STRICT: string;
        SECRET: string;
    };
}>;
export declare const PrivacyScanResultSchema: z.ZodObject<{
    event: z.ZodLiteral<"privacy.scan.result">;
    timestamp: z.ZodString;
    findings: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        issue: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high"]>;
    }, "strip", z.ZodTypeAny, {
        severity: "low" | "medium" | "high";
        field: string;
        issue: string;
    }, {
        severity: "low" | "medium" | "high";
        field: string;
        issue: string;
    }>, "many">;
    masked: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    event: "privacy.scan.result";
    timestamp: string;
    findings: {
        severity: "low" | "medium" | "high";
        field: string;
        issue: string;
    }[];
    masked: number;
}, {
    event: "privacy.scan.result";
    timestamp: string;
    findings: {
        severity: "low" | "medium" | "high";
        field: string;
        issue: string;
    }[];
    masked: number;
}>;
export declare const BridgeNotificationOutgoingSchema: z.ZodObject<{
    event: z.ZodLiteral<"bridge.notification.outgoing">;
    timestamp: z.ZodString;
    channel: z.ZodEnum<["telegram", "discord", "email", "webhook"]>;
    subject: z.ZodString;
    body: z.ZodString;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
    groupId: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    event: "bridge.notification.outgoing";
    timestamp: string;
    severity: "low" | "medium" | "high" | "critical";
    channel: "email" | "telegram" | "discord" | "webhook";
    subject: string;
    body: string;
    groupId?: string | undefined;
}, {
    event: "bridge.notification.outgoing";
    timestamp: string;
    severity: "low" | "medium" | "high" | "critical";
    channel: "email" | "telegram" | "discord" | "webhook";
    subject: string;
    body: string;
    groupId?: string | undefined;
}>;
export declare const BridgeWebhookSendSchema: z.ZodObject<{
    event: z.ZodLiteral<"bridge.webhook.send">;
    timestamp: z.ZodString;
    url: z.ZodString;
    signature: z.ZodString;
    payload: z.ZodRecord<z.ZodString, z.ZodAny>;
}, "strict", z.ZodTypeAny, {
    event: "bridge.webhook.send";
    timestamp: string;
    url: string;
    payload: Record<string, any>;
    signature: string;
}, {
    event: "bridge.webhook.send";
    timestamp: string;
    url: string;
    payload: Record<string, any>;
    signature: string;
}>;
export type PrivacyDataIngest = z.infer<typeof PrivacyDataIngestSchema>;
export type PrivacyDataNormalized = z.infer<typeof PrivacyDataNormalizedSchema>;
export type PrivacyPolicyUpdate = z.infer<typeof PrivacyPolicyUpdateSchema>;
export type PrivacyScanResult = z.infer<typeof PrivacyScanResultSchema>;
export type BridgeNotificationOutgoing = z.infer<typeof BridgeNotificationOutgoingSchema>;
export type BridgeWebhookSend = z.infer<typeof BridgeWebhookSendSchema>;
//# sourceMappingURL=privacy_bridge.d.ts.map