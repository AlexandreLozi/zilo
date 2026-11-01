/// <reference types="vitest/config" />
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Resolve workspace packages from their TypeScript sources (see the `zilo-source` export condition).
    conditions: ['zilo-source', ...defaultClientConditions],
  },
  build: {
    rolldownOptions: {
      onLog(level, log, handler) {
        // Radix ships React Server Components' "use client"; meaningless in this client-only app.
        if (log.code === 'MODULE_LEVEL_DIRECTIVE') return;
        handler(level, log);
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
