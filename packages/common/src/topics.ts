import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';

const TopicSchema = z.object({
  name: z.string().min(1),
  direction: z.enum(['in','out','both']),
  pii: z.enum(['none','low','basic','strict']),
  retention: z.object({
    memorySec: z.number().int().min(0),
    persistDays: z.number().int().min(0)
  }),
  owners: z.array(z.string().min(1)).min(1),
  notes: z.string().optional()
}).strict();

const TopicsFileSchema = z.array(TopicSchema).min(1);

export type Topic = z.infer<typeof TopicSchema>;

export function loadTopics(topicsFilePath: string): Topic[] {
  const full = path.resolve(topicsFilePath);
  const data = fs.readFileSync(full, 'utf8');
  const doc = yaml.load(data);
  const parsed = TopicsFileSchema.parse(doc);
  return parsed;
}
