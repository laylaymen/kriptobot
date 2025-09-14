import { describe, test, expect } from '@jest/globals';
/**
 * @vivo/contracts - Test Suite
 * Tests for event validation and schema compliance
 */

import { z } from 'zod';
import {
  TelemetryMetricsSchema,
  TelemetryAnomalySignalSchema,
  TelemetrySloStatusSchema,
  TelemetryRollupBatchSchema,
  TelemetryMetrics,
  TelemetryAnomalySignal,
  TelemetrySloStatus,
  TelemetryRollupBatch,
} from './events/telemetry';
import {
  SentryGuardDirectiveSchema,
  SentryFailoverRecommendationSchema,
  LatencySlipGuardDirectiveSchema,
  StreamIntegrityAlertSchema,
  OrderflowPacingPlanSchema,
  SentryGuardDirective,
  SentryFailoverRecommendation,
  LatencySlipGuardDirective,
  OrderflowPacingPlan,
} from './events/guard';
import {
  PortfolioBalanceDirectiveSchema,
  PositionSizeSuggestionSchema,
  ComposerIntentFilteredSchema,
  PortfolioBalanceDirective,
  PositionSizeSuggestion,
  ComposerIntentFiltered,
} from './events/portfolio';
import {
  PrivacyDataIngestSchema,
  PrivacyDataNormalizedSchema,
  PrivacyPolicyUpdateSchema,
  PrivacyScanResultSchema,
  BridgeNotificationOutgoingSchema,
  BridgeWebhookSendSchema,
  PrivacyDataIngest,
  PrivacyDataNormalized,
  PrivacyPolicyUpdate,
  PrivacyScanResult,
  BridgeNotificationOutgoing,
  BridgeWebhookSend,
} from './events/privacy_bridge';

const AllSchemas = {
  TelemetryMetrics: TelemetryMetricsSchema,
  TelemetryAnomalySignal: TelemetryAnomalySignalSchema,
  TelemetrySloStatus: TelemetrySloStatusSchema,
  TelemetryRollupBatch: TelemetryRollupBatchSchema,
  SentryGuardDirective: SentryGuardDirectiveSchema,
  SentryFailoverRecommendation: SentryFailoverRecommendationSchema,
  LatencySlipGuardDirective: LatencySlipGuardDirectiveSchema,
  StreamIntegrityAlert: StreamIntegrityAlertSchema,
  OrderflowPacingPlan: OrderflowPacingPlanSchema,
  PortfolioBalanceDirective: PortfolioBalanceDirectiveSchema,
  PositionSizeSuggestion: PositionSizeSuggestionSchema,
  ComposerIntentFiltered: ComposerIntentFilteredSchema,
  PrivacyDataIngest: PrivacyDataIngestSchema,
  PrivacyDataNormalized: PrivacyDataNormalizedSchema,
  PrivacyPolicyUpdate: PrivacyPolicyUpdateSchema,
  PrivacyScanResult: PrivacyScanResultSchema,
  BridgeNotificationOutgoing: BridgeNotificationOutgoingSchema,
  BridgeWebhookSend: BridgeWebhookSendSchema,
} as const;

const validateEvent = <T extends keyof typeof AllSchemas>(
  eventType: T,
  data: unknown
): { success: true; data: z.infer<(typeof AllSchemas)[T]> } | { success: false; error: string } => {
  try {
    const schema = AllSchemas[eventType];
    const result = schema.parse(data);
    return { success: true, data: result } as const;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown validation error' };
  }
};

const isValidEvent = <T extends keyof typeof AllSchemas>(eventType: T, data: unknown): data is z.infer<(typeof AllSchemas)[T]> => {
  try {
    AllSchemas[eventType].parse(data);
    return true;
  } catch {
    return false;
  }
};

describe('@vivo/contracts', () => {
  describe('Telemetry Metrics', () => {
    const validMetricsEvent: TelemetryMetrics = {
      event: "telemetry.metrics",
      timestamp: "2024-12-19T10:30:00.000Z",
      module: "sentry",
      metrics: {
        ping_p99: 125.5,
        gaps_count: 2,
        stream_health: 0.95
      },
      labels: {
        environment: "prod",
        region: "eu-west-1"
      }
    };

    test('validates correct metrics event', () => {
      const result = validateEvent('TelemetryMetrics', validMetricsEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.module).toBe("sentry");
        expect(result.data.metrics.ping_p99).toBe(125.5);
      }
    });

    test('rejects invalid metrics event', () => {
      const invalidEvent = { ...validMetricsEvent, event: "invalid" };
      const result = validateEvent('TelemetryMetrics', invalidEvent);
      expect(result.success).toBe(false);
    });

    test('type guard works correctly', () => {
      expect(isValidEvent('TelemetryMetrics', validMetricsEvent)).toBe(true);
      expect(isValidEvent('TelemetryMetrics', { invalid: true })).toBe(false);
    });
  });

  describe('SentryGuardDirective', () => {
    const validDirective: SentryGuardDirective = {
      event: "sentry.guard.directive",
      timestamp: "2024-12-19T10:30:00.000Z",
      correlationId: "corr_123456",
      directive: "block_aggressive",
      reason: "High volatility detected",
      severity: "high"
    };

    test('validates correct guard directive', () => {
      const result = validateEvent('SentryGuardDirective', validDirective);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.directive).toBe("block_aggressive");
        expect(result.data.severity).toBe("high");
      }
    });

    test('rejects invalid directive', () => {
      const invalidDirective = { ...validDirective, directive: "invalid_directive" };
      const result = validateEvent('SentryGuardDirective', invalidDirective);
      expect(result.success).toBe(false);
    });
  });

  describe('Guard & Infrastructure Events', () => {
    test('sentry.failover.recommendation valid', () => {
      const ev: SentryFailoverRecommendation = {
        event: 'sentry.failover.recommendation',
        timestamp: '2024-12-19T10:30:00.000Z',
        planId: 'plan-1',
        from: 'primary',
        to: 'secondary',
        reason: 'streams_panic',
        etaSec: 30
      };
      expect(isValidEvent('SentryFailoverRecommendation', ev)).toBe(true);
    });

    test('latency_slip.guard.directive valid', () => {
      const ev: LatencySlipGuardDirective = {
        event: 'latency_slip.guard.directive',
        timestamp: '2024-12-19T10:30:00.000Z',
        correlationId: 'c1',
        placeLatencyMsP95: 250,
        firstFillLatencyMsP95: 400,
        slipBpP95: 15,
        mode: 'soft_guard',
        action: 'reduce_size'
      };
      expect(isValidEvent('LatencySlipGuardDirective', ev)).toBe(true);
    });

    test('stream.integrity.alert invalid kind rejected', () => {
      const ev: any = {
        event: 'stream.integrity.alert',
        timestamp: '2024-12-19T10:30:00.000Z',
        kind: 'weird',
        severity: 'high'
      };
      expect(isValidEvent('StreamIntegrityAlert', ev)).toBe(false);
    });

    test('orderflow.pacing.plan valid', () => {
      const ev: OrderflowPacingPlan = {
        event: 'orderflow.pacing.plan',
        timestamp: '2024-12-19T10:30:00.000Z',
        maxInFlight: 10,
        deferNew: true,
        dropNew: false,
        reason: 'backpressure_high'
      };
      expect(isValidEvent('OrderflowPacingPlan', ev)).toBe(true);
    });
  });

  describe('Telemetry & SLO', () => {
    test('anomaly.signal valid', () => {
      const ev: TelemetryAnomalySignal = {
        event: 'telemetry.anomaly.signal',
        timestamp: '2024-12-19T10:30:00.000Z',
        kind: 'spike',
        value: 1.2,
        baseline: 0.8,
        score: 0.92
      };
      expect(isValidEvent('TelemetryAnomalySignal', ev)).toBe(true);
    });

    test('slo.status breach valid', () => {
      const ev: TelemetrySloStatus = {
        event: 'telemetry.slo.status',
        timestamp: '2024-12-19T10:30:00.000Z',
        slo: 'guard_success_rate',
        status: 'breach',
        errorBudgetRemaining: 0.1,
        window: '24h'
      };
      expect(isValidEvent('TelemetrySloStatus', ev)).toBe(true);
    });

    test('rollup.batch requires series', () => {
      const ev: TelemetryRollupBatch = {
        event: 'telemetry.rollup.batch',
        timestamp: '2024-12-19T10:30:00.000Z',
        resolution: '1m',
        series: [{ name: 'latency', points: [[0,1],[1,2]] }]
      };
      expect(isValidEvent('TelemetryRollupBatch', ev)).toBe(true);
    });
  });

  describe('Portfolio & Composer', () => {
    test('portfolio.balance.directive valid', () => {
      const ev: PortfolioBalanceDirective = {
        event: 'portfolio.balance.directive',
        timestamp: '2024-12-19T10:30:00.000Z',
        capUsd: 100000,
        perSymbolCapUsd: 5000,
        rebalance: true,
        reason: 'risk_cap_update'
      };
      expect(isValidEvent('PortfolioBalanceDirective', ev)).toBe(true);
    });

    test('position.size.suggestion valid', () => {
      const ev: PositionSizeSuggestion = {
        event: 'position.size.suggestion',
        timestamp: '2024-12-19T10:30:00.000Z',
        symbol: 'BTCUSDT',
        strategy: 'trend_v2',
        baseSizeUsd: 1200,
        adjustPct: -0.2,
        reason: 'volatility_high'
      };
      expect(isValidEvent('PositionSizeSuggestion', ev)).toBe(true);
    });

    test('composer.intent.filtered valid', () => {
      const ev: ComposerIntentFiltered = {
        event: 'composer.intent.filtered',
        timestamp: '2024-12-19T10:30:00.000Z',
        symbol: 'ETHUSDT',
        strategy: 'meanrev_v1',
        variant: 'conservative',
        allowed: false,
        reasonCodes: ['policy_conservative_only']
      };
      expect(isValidEvent('ComposerIntentFiltered', ev)).toBe(true);
    });
  });

  describe('Privacy & Bridge', () => {
    test('privacy.data.ingest valid', () => {
      const ev: PrivacyDataIngest = {
        event: 'privacy.data.ingest',
        timestamp: '2024-12-19T10:30:00.000Z',
        classification: 'PII_BASIC',
        payload: { email: 'user@example.com' },
        source: 'ingest-api'
      };
      expect(isValidEvent('PrivacyDataIngest', ev)).toBe(true);
    });

    test('privacy.data.normalized requires expiresAt', () => {
      const ev: PrivacyDataNormalized = {
        event: 'privacy.data.normalized',
        timestamp: '2024-12-19T10:30:00.000Z',
        classification: 'PII_BASIC',
        payload: { emailHash: 'abcd' },
        expiresAt: '2025-01-19T10:30:00.000Z'
      };
      expect(isValidEvent('PrivacyDataNormalized', ev)).toBe(true);
    });

    test('privacy.policy.update valid', () => {
      const ev: PrivacyPolicyUpdate = {
        event: 'privacy.policy.update',
        timestamp: '2024-12-19T10:30:00.000Z',
        version: 1,
        defaults: { PII_BASIC: 'P90D', PII_STRICT: 'P30D', SECRET: 'P0D' }
      };
      expect(isValidEvent('PrivacyPolicyUpdate', ev)).toBe(true);
    });

    test('privacy.scan.result with findings', () => {
      const ev: PrivacyScanResult = {
        event: 'privacy.scan.result',
        timestamp: '2024-12-19T10:30:00.000Z',
        findings: [{ field: 'email', issue: 'pii', severity: 'medium' }],
        masked: 1
      };
      expect(isValidEvent('PrivacyScanResult', ev)).toBe(true);
    });

    test('bridge.notification.outgoing valid', () => {
      const ev: BridgeNotificationOutgoing = {
        event: 'bridge.notification.outgoing',
        timestamp: '2024-12-19T10:30:00.000Z',
        channel: 'telegram',
        subject: 'Alert',
        body: 'Something happened',
        severity: 'high',
      };
      expect(isValidEvent('BridgeNotificationOutgoing', ev)).toBe(true);
    });

    test('bridge.webhook.send url required', () => {
      const ev: BridgeWebhookSend = {
        event: 'bridge.webhook.send',
        timestamp: '2024-12-19T10:30:00.000Z',
        url: 'https://example.com/hook',
        signature: 'abcd',
        payload: { ok: true }
      };
      expect(isValidEvent('BridgeWebhookSend', ev)).toBe(true);
    });
  });

  describe('Schema collection', () => {
    test('AllSchemas contains expected schemas', () => {
      expect(AllSchemas.TelemetryMetrics).toBeDefined();
      expect(AllSchemas.SentryGuardDirective).toBeDefined();
      expect(AllSchemas.PortfolioBalanceDirective).toBeDefined();
      expect(Object.keys(AllSchemas).length).toBeGreaterThanOrEqual(12);
    });
  });

  describe('Error handling', () => {
    test('validateEvent returns proper error structure', () => {
      const result = validateEvent('TelemetryMetrics', { invalid: 'data' } as any);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(typeof result.error).toBe('string');
        expect(result.error.length).toBeGreaterThan(0);
      }
    });

    test('isValidEvent handles malformed data gracefully', () => {
      expect(isValidEvent('TelemetryMetrics', null as any)).toBe(false);
      expect(isValidEvent('TelemetryMetrics', undefined as any)).toBe(false);
      expect(isValidEvent('TelemetryMetrics', "not an object" as any)).toBe(false);
    });
  });
});
