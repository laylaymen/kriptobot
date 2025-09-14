import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';

export interface LoadOptions {
  moduleName: string;
  cfgDir?: string; // default ./cfg
}

// Example generic schema; real modules can compose this
export const BaseModuleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  logLevel: z.enum(['debug','info','warn','error']).default('info')
}).strict();

export type BaseModuleConfig = z.infer<typeof BaseModuleConfigSchema>;

export function loadConfig<T extends z.ZodTypeAny>(opts: LoadOptions, schema: T): z.infer<T> {
  const dir = path.resolve(opts.cfgDir || path.resolve(process.cwd(), 'cfg'));
  const file = path.join(dir, `${opts.moduleName}.yaml`);

  let raw: any = {};
  if (fs.existsSync(file)) {
    const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    raw = doc;
  }

  // ENV overrides: VIVO_<MODULE>__KEY=VALUE (double underscore for nested)
  const prefix = `VIVO_${opts.moduleName.toUpperCase()}__`;
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith(prefix)) continue;
    const pathKeys = k
      .substring(prefix.length)
      .split('__')
      .map(s => s.replace(/_/g, '').toLowerCase());
    setDeep(raw, pathKeys, coerceEnv(v as string));
  }

  // Validate and return immutable copy
  const parsed = schema.parse(raw);
  return deepFreeze(parsed);
}

function setDeep(obj: any, keys: string[], value: any) {
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const kDesired = keys[i];
    const existingKey = findExistingKey(cur, kDesired);
    const k = existingKey ?? kDesired;
    if (!(k in cur)) cur[k] = {};
    cur = cur[k];
  }
  const leafDesired = keys[keys.length - 1];
  const leafKey = findExistingKey(cur, leafDesired) ?? leafDesired;
  cur[leafKey] = value;
}

function findExistingKey(obj: any, desiredLowerNoUnderscore: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const norm = (s: string) => s.replace(/_/g, '').toLowerCase();
  return Object.keys(obj).find(kk => norm(kk) === desiredLowerNoUnderscore);
}

function coerceEnv(v: string): any {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const num = Number(v);
  if (!Number.isNaN(num)) return num;
  return v;
}

function deepFreeze<T>(o: T): T {
  Object.freeze(o);
  Object.getOwnPropertyNames(o as any).forEach((prop) => {
    const value: any = (o as any)[prop];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  });
  return o;
}
