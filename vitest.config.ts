import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const project = (directory: string) => ({
  test: {
    name: directory,
    root: `./${directory}`,
    include: ['src/**/*.test.ts'],
    environment: 'node' as const,
    passWithNoTests: true,
  },
});

// The daemon value-imports @codebox/* at runtime and the gate tests before it builds, so its
// tests resolve the package sources instead of a dist that does not exist yet.
const daemonProject = {
  test: {
    name: 'apps/daemon',
    root: './apps/daemon',
    include: ['src/**/*.test.ts'],
    environment: 'node' as const,
    passWithNoTests: true,
  },
  resolve: {
    alias: [
      {
        find: /^@codebox\/([a-z-]+)$/,
        replacement: `${fileURLToPath(new URL('./packages/', import.meta.url))}$1/src/index.ts`,
      },
    ],
  },
};

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      daemonProject,
      project('packages/contracts'),
      project('packages/core'),
      project('packages/backlog'),
      project('packages/store'),
      project('packages/opencode'),
      project('packages/workspaces'),
      project('packages/scheduler'),
      project('packages/git-provider'),
      project('packages/security'),
      {
        test: {
          name: 'scripts',
          root: './scripts',
          include: ['**/*.test.mjs'],
          environment: 'node' as const,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'ops',
          root: './ops',
          include: ['**/test/**/*.test.mjs'],
          environment: 'node' as const,
          passWithNoTests: true,
          // Every test here shells out to a cold binary (packer, oci, openssl, bash). The first
          // spawn of `packer fmt` measured 9–19 s on a CI runner against Vitest's 5 s default, so
          // the budget is explicit instead of racing the cold tree.
          testTimeout: 120_000,
        },
      },
    ],
  },
});
