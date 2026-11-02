/// <reference types="vitest/config" />
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Test against @zilo/ui's TypeScript sources, so tests do not depend on a prior build.
    conditions: ['zilo-source', ...defaultClientConditions],
  },
});
