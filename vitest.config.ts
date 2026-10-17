import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) } },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    testTimeout: 20_000,
  },
});
