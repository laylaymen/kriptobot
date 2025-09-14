# @vivo/contracts

Shared event interfaces and Zod schemas for the VIVO system.

- TypeScript definitions and runtime validation for events
- ES Module output in `dist/`
- Helper utilities: `validateEvent`, `isValidEvent`, and `AllSchemas`

## Scripts

- build: Type-check and emit to `dist/`
- test: Run Jest tests
- typecheck: TypeScript no-emit check

## Usage

```ts
import { TelemetryMetricsSchema, validateEvent } from '@vivo/contracts';

const ev = { event: 'telemetry.metrics', timestamp: new Date().toISOString(), module: 'sentry', metrics: { ping: 10 } };
const ok = validateEvent('TelemetryMetrics', ev);
```

## Adding New Events
- Create a schema under `src/events/*.ts`
- Export it from `src/index.ts`
- Add tests in `src/index.test.ts`