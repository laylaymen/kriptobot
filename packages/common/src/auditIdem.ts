import fs from 'fs';
import path from 'path';

export interface AuditContext {
  module: string;
  src?: string;
  runId?: string;
  operator?: string;
}

export function makeAudit(event: Record<string, unknown>, ctx: AuditContext) {
  return {
    ...event,
    audit: {
      module: ctx.module,
      src: ctx.src || 'INF-04',
      runId: ctx.runId || `run_${Date.now()}`,
      ts: new Date().toISOString()
    }
  };
}

const memoryIndex = new Map<string, number>();

export function isDuplicate(idemKey: string, ttlSec: number, persistDir?: string): boolean {
  const now = Date.now();
  const ttlMs = ttlSec * 1000;

  // Memory check
  const prev = memoryIndex.get(idemKey);
  if (prev && now - prev < ttlMs) return true;

  // Optional file-backed check
  if (persistDir) {
    const dir = path.resolve(persistDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'idem.index');
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          const [key, tsStr] = line.split(',');
          const ts = Number(tsStr);
          if (key === idemKey && now - ts < ttlMs) {
            return true;
          }
        }
      } catch {
        // ignore corrupt file
      }
    }
    // Append current key
    try {
      fs.appendFileSync(file, `${idemKey},${now}\n`, 'utf8');
    } catch {
      // ignore fs errors
    }
  }

  memoryIndex.set(idemKey, now);
  return false;
}
