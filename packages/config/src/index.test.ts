import { describe, test, expect } from '@jest/globals';
import path from 'path';
import { z } from 'zod';
import { loadConfig } from './index';

const SentryCfg = z.object({
  enabled: z.boolean(),
  logLevel: z.enum(['debug','info','warn','error']),
  pingThresholdMs: z.number().int().min(0)
}).strict();

describe('config loader', () => {
  test('loads YAML config', () => {
    const cfg = loadConfig({ moduleName: 'sentry', cfgDir: path.resolve(__dirname, '../../../cfg') }, SentryCfg);
    expect(cfg.enabled).toBe(true);
    expect(cfg.pingThresholdMs).toBe(500);
  });

  test('env overrides are applied', () => {
    process.env.VIVO_SENTRY__PINGTHRESHOLDMS = '750';
    const cfg = loadConfig({ moduleName: 'sentry', cfgDir: path.resolve(__dirname, '../../../cfg') }, SentryCfg);
    expect(cfg.pingThresholdMs).toBe(750);
    delete process.env.VIVO_SENTRY__PINGTHRESHOLDMS;
  });
});
