import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  // The shared package is TypeScript source, so it is bundled in; everything else stays in node_modules.
  noExternal: ['@baatcheet/shared'],
  sourcemap: true,
  clean: true,
});
