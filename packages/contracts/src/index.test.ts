import { describe, expect, it } from 'vitest';
import {
  ROUTINE_TOOL_NAMES,
  SSE_EVENT_NAMES,
  idSchema,
  parseRepoSchedule,
  parseRoutine,
  parseSession,
  parseWork,
  routineSchema,
  timestampSchema,
} from './index.js';

const NOW = '2026-10-24T18:03:11Z';

describe('entry point', () => {
  it('re-exports the primitives through index.js', () => {
    expect(SSE_EVENT_NAMES).toHaveLength(38);
    expect(idSchema('run').safeParse('run_01JABCDEFG').success).toBe(true);
    expect(timestampSchema.safeParse(NOW).success).toBe(true);
  });

  it('re-exports the work, session and repository schedule through index.js', () => {
    expect(
      parseWork({
        id: 'wrk_01JABCDEFG',
        repoId: 'repo_01JABCDEFG',
        backlogRef: 'Task-35',
        title: 'Routine engine',
        prompt: 'Build the routine engine.',
        specSha: '9f1c2ab',
        state: 'queued',
        origin: 'backlog',
        attempts: 0,
        maxAttempts: 2,
        usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
        contextTokens: 0,
        contextEpoch: 1,
        reviewedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }).id,
    ).toBe('wrk_01JABCDEFG');
    expect(
      parseSession({
        id: 'sess_01JABCDEFG',
        repoId: 'repo_01JABCDEFG',
        target: 'repo',
        workId: null,
        title: 'Read the repository',
        status: 'idle',
        branch: null,
        pendingProposal: null,
        usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
        contextTokens: 0,
        contextEpoch: 1,
        createdAt: NOW,
        updatedAt: NOW,
        lastMessage: null,
      }).target,
    ).toBe('repo');
    expect(
      parseRepoSchedule({
        id: 'sch_01JABCDEFG',
        repoId: 'repo_01JABCDEFG',
        mode: 'every',
        cron: '0 3 * * *',
        timezone: 'UTC',
        windowStart: null,
        windowEnd: null,
        cooldownMinutes: 0,
        selection: 'nextPending',
        refs: [],
        maxAttempts: 2,
        maxFires: null,
        maxCostPerFireUsd: null,
        consecutiveFailures: 0,
        firesCount: 0,
        spendUsd: 0,
        enabled: true,
        nextFireAt: null,
        lastFiredAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }).selection,
    ).toBe('nextPending');
  });

  it('re-exports the routine surface through index.js', () => {
    const reminder = {
      id: 'rtn_01JABCDEFG',
      kind: 'reminder',
      title: 'Take the pill',
      cron: '0 10 * * *',
      timezone: 'Europe/Madrid',
      enabled: true,
      notify: true,
      createdAt: '2026-10-24T18:03:11Z',
      nextFireAt: null,
      lastFiredAt: null,
    };
    expect(parseRoutine(reminder)).toEqual(reminder);
    expect(routineSchema.safeParse(reminder).success).toBe(true);
    expect([...ROUTINE_TOOL_NAMES]).toEqual(['routine.create', 'routine.list', 'routine.pause']);
  });
});
