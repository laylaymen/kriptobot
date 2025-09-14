let exporter = null;
export function setMetricsExporter(fn) {
    exporter = fn;
}
export function exportMetric(event) {
    if (exporter) {
        return exporter(event);
    }
}
