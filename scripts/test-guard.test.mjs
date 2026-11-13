import { describe, expect, it } from 'vitest';
import { auditWorkspaces } from './test-guard.mjs';

function workspace(dir, name, test) {
  return { dir, name, test };
}

describe('auditWorkspaces', () => {
  it('covers a workspace the npm gate runs', () => {
    const result = auditWorkspaces({
      gate: 'npm run test:guard && npm test -w @codebox/app && vitest run',
      vitest: "project('packages/core'),",
      workspaces: [workspace('apps/app', '@codebox/app', 'ng test --watch=false')],
    });
    expect(result.covered).toEqual(['apps/app (npm --workspace)']);
    expect(result.problems).toEqual([]);
  });

  it('covers a workspace the vitest project runs', () => {
    const result = auditWorkspaces({
      gate: 'npm run test:guard && npm run test:app -w @codebox/app && vitest run',
      vitest: "project('packages/core'),",
      workspaces: [workspace('packages/core', '@codebox/core', 'vitest run')],
    });
    expect(result.covered).toEqual(['packages/core (vitest project)']);
    expect(result.problems).toEqual([]);
  });

  it('reports a workspace the gate does not run', () => {
    const result = auditWorkspaces({
      gate: 'npm run test:app -w @codebox/app && vitest run',
      vitest: "project('packages/core'),",
      workspaces: [workspace('apps/orphan', '@codebox/orphan', 'vitest run')],
    });
    expect(result.covered).toEqual([]);
    expect(result.problems).toEqual([
      'apps/orphan: has a test script but the gate does not run it',
    ]);
  });

  it('reports a workspace the gate runs twice', () => {
    const result = auditWorkspaces({
      gate: 'npm run test:app -w @codebox/core && vitest run',
      vitest: "project('packages/core'),",
      workspaces: [workspace('packages/core', '@codebox/core', 'vitest run')],
    });
    expect(result.covered).toEqual([]);
    expect(result.problems).toEqual([
      'packages/core: the gate runs its test script twice (vitest project and npm --workspace)',
    ]);
  });

  it('ignores a workspace without a test script', () => {
    const result = auditWorkspaces({
      gate: 'npm run test:app -w @codebox/app && vitest run',
      vitest: "project('packages/core'),",
      workspaces: [workspace('packages/contracts', '@codebox/contracts', null)],
    });
    expect(result.covered).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it('keeps the lookahead and the input order', () => {
    const result = auditWorkspaces({
      gate: 'npm run test:app -w @codebox/application',
      vitest: "project('packages/core'),",
      workspaces: [
        workspace('apps/orphan', '@codebox/orphan', 'vitest run'),
        workspace('apps/app', '@codebox/app', 'ng test --watch=false'),
        workspace('packages/core', '@codebox/core', 'vitest run'),
      ],
    });
    expect(result.problems).toEqual([
      'apps/orphan: has a test script but the gate does not run it',
      'apps/app: has a test script but the gate does not run it',
    ]);
    expect(result.covered).toEqual(['packages/core (vitest project)']);
  });
});
