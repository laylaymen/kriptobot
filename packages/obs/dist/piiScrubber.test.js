import { scrubLogPII } from './piiScrubber';
describe('scrubLogPII', () => {
    const base = {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'User email: alice@example.com',
        module: 'test',
        context: { email: 'alice@example.com', ip: '1.2.3.4' },
        pii: 'basic',
    };
    it('leaves non-PII events untouched', () => {
        const e = { ...base, pii: 'none' };
        expect(scrubLogPII(e, 'basic')).toEqual(e);
    });
    it('scrubs when event PII > maxLevel', () => {
        const e = { ...base, pii: 'strict' };
        const scrubbed = scrubLogPII(e, 'basic');
        expect(scrubbed.message).toBe('[REDACTED]');
        expect(scrubbed.context).toEqual({ email: '[REDACTED]', ip: '[REDACTED]' });
    });
    it('does not scrub when event PII <= maxLevel', () => {
        const e = { ...base, pii: 'low' };
        expect(scrubLogPII(e, 'basic')).toEqual(e);
    });
});
