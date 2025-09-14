import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { makeAudit, isDuplicate } from './auditIdem';

describe('audit & idempotency helpers', () => {
  test('makeAudit adds audit context with defaults', () => {
    const ev = { event: 'test', payload: { ok: true } };
    const out = makeAudit(ev, { module: 'unit' });
    expect(out.audit).toBeDefined();
    expect(out.audit.module).toBe('unit');
    expect(out.audit.src).toBe('INF-04');
    expect(typeof out.audit.runId).toBe('string');
    expect(typeof out.audit.ts).toBe('string');
  });

  test('isDuplicate returns true within ttl for same key (memory)', () => {
    const key = 'dup-key-memory';
    const first = isDuplicate(key, 2);
    const second = isDuplicate(key, 2);
    expect(first).toBe(false);
    expect(second).toBe(true);
  });

  test('isDuplicate considers file-backed index when provided', () => {
    const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'idem-test-'));
    try {
      const key = 'dup-key-file';
      const first = isDuplicate(key, 5, tmpDir);
      const second = isDuplicate(key, 5, tmpDir);
      expect(first).toBe(false);
      expect(second).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
