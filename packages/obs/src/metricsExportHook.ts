import { MetricEvent } from './metricsTypes';

/**
 * Minimal metrics export hook interface.
 * Allows plugging in custom metrics sinks (Prometheus, Datadog, etc).
 */
export type MetricsExporter = (event: MetricEvent) => void | Promise<void>;

let exporter: MetricsExporter | null = null;

export function setMetricsExporter(fn: MetricsExporter) {
  exporter = fn;
}

export function exportMetric(event: MetricEvent) {
  if (exporter) {
    return exporter(event);
  }
}
