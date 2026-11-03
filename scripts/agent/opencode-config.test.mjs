import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The permission nobody tested drifted: three of the four pipeline roles could fetch an
// arbitrary URL while `docs/agent-ci.md` §10 and `docs/agent-vm.md` §10 promised the rule for
// every role. The test is the control (D60).
const config = JSON.parse(readFileSync(new URL('../../opencode.json', import.meta.url), 'utf8'));
const ROLES = ['orchestrator', 'architect', 'dev', 'qa'];

describe('opencode.json', () => {
  it.each(ROLES)('agent %s exists and denies webfetch', (role) => {
    const agent = config.agent?.[role];
    expect(agent).toBeDefined();
    expect(agent.permission?.webfetch).toBe('deny');
  });
});
