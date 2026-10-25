import { defineConfig } from 'vitest/config';

// The route spec awaits every lazy loader; on a cold cache under parallel load that exceeds
// Vitest's 5 s default, so the budget is explicit instead of racing the cold tree.
export default defineConfig({
  test: {
    testTimeout: 30000,
  },
});
