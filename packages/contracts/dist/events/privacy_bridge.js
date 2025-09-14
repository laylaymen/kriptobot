import { z } from "zod";
const Timestamp = z.string().datetime();
export const PrivacyDataIngestSchema = z.object({
    event: z.literal("privacy.data.ingest"),
    timestamp: Timestamp,
    classification: z.enum(["NONE", "PII_LOW", "PII_BASIC", "PII_STRICT", "SECRET"]),
    payload: z.record(z.string(), z.any()),
    source: z.string().min(1)
}).strict();
export const PrivacyDataNormalizedSchema = z.object({
    event: z.literal("privacy.data.normalized"),
    timestamp: Timestamp,
    classification: z.enum(["NONE", "PII_LOW", "PII_BASIC", "PII_STRICT", "SECRET"]),
    payload: z.record(z.string(), z.any()),
    expiresAt: z.string().datetime()
}).strict();
export const PrivacyPolicyUpdateSchema = z.object({
    event: z.literal("privacy.policy.update"),
    timestamp: Timestamp,
    version: z.number().int().min(1),
    defaults: z.object({
        PII_BASIC: z.string(),
        PII_STRICT: z.string(),
        SECRET: z.string()
    })
}).strict();
export const PrivacyScanResultSchema = z.object({
    event: z.literal("privacy.scan.result"),
    timestamp: Timestamp,
    findings: z.array(z.object({ field: z.string(), issue: z.string(), severity: z.enum(["low", "medium", "high"]) })),
    masked: z.number().int().min(0)
}).strict();
export const BridgeNotificationOutgoingSchema = z.object({
    event: z.literal("bridge.notification.outgoing"),
    timestamp: Timestamp,
    channel: z.enum(["telegram", "discord", "email", "webhook"]),
    subject: z.string().min(1),
    body: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"]),
    groupId: z.string().min(1).optional()
}).strict();
export const BridgeWebhookSendSchema = z.object({
    event: z.literal("bridge.webhook.send"),
    timestamp: Timestamp,
    url: z.string().url(),
    signature: z.string().min(1),
    payload: z.record(z.string(), z.any())
}).strict();
//# sourceMappingURL=privacy_bridge.js.map