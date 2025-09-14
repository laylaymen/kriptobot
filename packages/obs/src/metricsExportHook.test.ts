import { setMetricsExporter, exportMetric } from './metricsExportHook';
import { MetricEvent } from './metricsTypes';

describe('metricsExportHook', () => {
  it('calls the exporter with the metric event', async () => {
    let called = false;
    const event: MetricEvent = {
      timestamp: new Date().toISOString(),
      module: 'test',
      name: 'test.metric',
      value: 42,
      labels: { foo: 'bar' },
    };
    setMetricsExporter((e) => {
      called = true;
      expect(e).toEqual(event);
    });
    exportMetric(event);
    expect(called).toBe(true);
  });
});
