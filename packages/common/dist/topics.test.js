import { describe, test, expect } from '@jest/globals';
import path from 'path';
import { loadTopics } from './topics';
describe('topics loader', () => {
    test('loads and validates topics.yaml', () => {
        const p = path.resolve(__dirname, '../../../config/topics.yaml');
        const topics = loadTopics(p);
        expect(Array.isArray(topics)).toBe(true);
        expect(topics.length).toBeGreaterThanOrEqual(3);
        const t = topics.find(t => t.name === 'sentry.guard.directive');
        expect(t?.direction).toBe('out');
        expect(t?.retention.persistDays).toBeGreaterThan(0);
    });
});
