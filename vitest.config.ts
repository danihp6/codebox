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

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      project('apps/daemon'),
      project('packages/contracts'),
      project('packages/core'),
      project('packages/store'),
      project('packages/opencode'),
      project('packages/workspaces'),
      project('packages/scheduler'),
      project('packages/git-provider'),
      project('packages/security'),
    ],
  },
});
