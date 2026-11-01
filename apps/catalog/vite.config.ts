/// <reference types="vitest/config" />
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Resolve workspace packages from their TypeScript sources (see the `zilo-source` export condition).
    conditions: ['zilo-source', ...defaultClientConditions],
  },
  build: {
    rolldownOptions: {
      onwarn(warning, warn) {
        // Radix ships React Server Components' "use client"; meaningless in this client-only app.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'happy-dom',
  },
});
