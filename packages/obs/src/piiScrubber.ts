import { LogEvent } from './logTypes';

// PII levels: none < low < basic < strict
const PII_LEVELS = ['none', 'low', 'basic', 'strict'] as const;

type PiiLevel = typeof PII_LEVELS[number];

/**
 * Scrub PII fields from a log event according to the max allowed level.
 * Any field at or above the maxLevel is replaced with '[REDACTED]'.
 */
export function scrubLogPII(event: LogEvent, maxLevel: PiiLevel = 'none'): LogEvent {
  if (!event.pii || event.pii === 'none') return event;
  const eventLevelIdx = PII_LEVELS.indexOf(event.pii);
  const maxLevelIdx = PII_LEVELS.indexOf(maxLevel);
  if (eventLevelIdx < 0 || maxLevelIdx < 0) return event;
  if (eventLevelIdx <= maxLevelIdx) return event;
  // Scrub message and context
  return {
    ...event,
    message: '[REDACTED]',
    context: event.context ? { ...Object.fromEntries(Object.keys(event.context).map(k => [k, '[REDACTED]'])) } : undefined
  };
}
