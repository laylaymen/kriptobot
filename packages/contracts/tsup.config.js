import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index-debug.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  bundle: true,
  external: ['zod'],
  esbuildOptions(options) {
    options.conditions = ['import', 'module', 'default'];
  },
});