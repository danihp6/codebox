import { describe, expect, it } from 'vitest';
import { GUARDRAIL_IDS } from '@codebox/contracts';
import type { GuardrailFact } from '@codebox/core';
import type { PrBodyInput } from './pr-body.js';
import { buildPrBody, formatDuration } from './pr-body.js';

const RUN_ID = 'run_prbody01AB';
const CLONE_URL = 'https://x-access-token:ghp_fixture_secret@github.com/acme/widgets.git';

function guardrails(failing: readonly string[] = []): readonly GuardrailFact[] {
  return GUARDRAIL_IDS.map((id) =>
    failing.includes(id) ? { id, state: 'fail', reason: 'base_moved' } : { id, state: 'pass' },
  );
}

function prInput(overrides: Partial<PrBodyInput> = {}): PrBodyInput {
  return {
    title: 'Add the feature flag',
    runId: RUN_ID,
    jobId: 'job_prbody01AB',
    agent: 'build',
    model: 'anthropic/claude-sonnet-4',
    agentMessage: '  It adds the flag behind an environment variable.  ',
    gate: {
      status: 'passed',
      exitCode: 0,
      durationMs: 184_000,
      timedOut: false,
      cancelled: false,
      tail: ['> ls', 'ok'],
      logFile: '/srv/codebox/logs/run-prbody/gate.log',
    },
    diff: {
      files: 6,
      added: 184,
      removed: 22,
      changedFiles: [{ path: 'src/flag.ts', status: 'added', added: 184, removed: 22 }],
    },
    guardrails: guardrails(),
    blockers: [],
    gateCommand: 'npm ci && npm test && npm run build',
    ...overrides,
  };
}

describe('buildPrBody', () => {
  it('renders the sections of docs/jobs.md §6 in order', () => {
    const body = buildPrBody(prInput());
    const sections = [
      '## Add the feature flag',
      '### What changed',
      '### Gate',
      '### Diff',
      '### Guardrails',
    ];
    let cursor = -1;
    for (const section of sections) {
      const index = body.indexOf(section);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
    expect(body).toContain(
      'Run: run_prbody01AB · Job: job_prbody01AB · Agent: build · Model: anthropic/claude-sonnet-4',
    );
    expect(body).toContain('It adds the flag behind an environment variable.');
    expect(body).toContain('`npm ci && npm test && npm run build` — exit 0 in 3m 04s');
    expect(body).toContain('6 files · +184 −22');
  });

  it('renders a dash for an absent job and model', () => {
    const body = buildPrBody(prInput({ jobId: null, model: null }));
    expect(body).toContain('Run: run_prbody01AB · Job: — · Agent: build · Model: —');
  });

  it('collapses the last twenty gate lines', () => {
    const tail = Array.from({ length: 30 }, (_value, index) => `line ${index + 1}`);
    const body = buildPrBody(prInput({ gate: { ...prInput().gate, tail } }));
    expect(body).toContain('line 11');
    expect(body).toContain('line 30');
    expect(body).not.toContain('line 10\n');
    expect(body).toContain('<details>');
    expect(body).toContain('<summary>Last 20 lines</summary>');
  });

  it('ticks every passing guardrail and leaves the failing one with its reason', () => {
    const body = buildPrBody(
      prInput({
        guardrails: guardrails(['base']),
        blockers: [{ code: 'base_moved', message: 'The base branch moved during the run.' }],
      }),
    );
    const lines = body.split('\n').filter((line) => line.startsWith('- ['));
    expect(lines).toHaveLength(GUARDRAIL_IDS.length);
    expect(lines[GUARDRAIL_IDS.indexOf('base')]).toBe(
      '- [ ] base — The base branch moved during the run.',
    );
    expect(lines[GUARDRAIL_IDS.indexOf('gate')]).toBe('- [x] gate');
    expect(lines[GUARDRAIL_IDS.indexOf('automerger')]).toBe('- [x] automerger');
    expect(lines.map((line) => /^- \[[ x]\] (\S+)/.exec(line)?.[1])).toEqual([...GUARDRAIL_IDS]);
  });

  it('keeps the failing guardrail line when no blocker message explains it', () => {
    const body = buildPrBody(prInput({ guardrails: guardrails(['checks']), blockers: [] }));
    expect(body).toContain('- [ ] checks — base_moved');
  });

  it('trims a long agent message to two thousand characters', () => {
    const body = buildPrBody(prInput({ agentMessage: 'y'.repeat(5_000) }));
    const tailLength = body.split('\n').filter((line) => line.startsWith('y')).length;
    expect(tailLength).toBe(1);
    const messageLine = body.split('\n').find((line) => line.startsWith('y')) ?? '';
    expect(messageLine).toHaveLength(2_000);
  });

  it('never carries the clone URL or a token', () => {
    const body = buildPrBody(prInput());
    expect(body).not.toContain(CLONE_URL);
    expect(body).not.toContain('ghp_');
    expect(body).not.toContain('x-access-token');
  });
});

describe('formatDuration', () => {
  it('renders seconds and minutes', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(1_400)).toBe('1s');
    expect(formatDuration(184_000)).toBe('3m 04s');
    expect(formatDuration(3_600_000)).toBe('60m 00s');
  });
});
