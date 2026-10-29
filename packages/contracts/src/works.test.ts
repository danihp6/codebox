import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import {
  backlogSchema,
  parseBacklog,
  parseRepoSchedule,
  parseSession,
  parseSessionMessage,
  parseWork,
  parseWorkDetail,
  repoScheduleSchema,
  sessionMessageSchema,
  sessionProposalSchema,
  sessionSchema,
  workDetailSchema,
  workSchema,
} from './works.js';

const NOW = '2026-10-28T09:12:00Z';
const REPO_ID = 'repo_01JABCDEFG';
const WORK_ID = 'wrk_01JABCDEFG';
const SESSION_ID = 'sess_01JABCDEFG';
const REPO = {
  id: REPO_ID,
  slug: 'dani/example',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['ops/**'],
  enabled: true,
  createdAt: NOW,
};

const work = {
  id: WORK_ID,
  repoId: REPO_ID,
  backlogRef: 'Task-35',
  title: 'Routine engine',
  prompt: 'Build the routine engine and its tests.',
  specSha: '9f1c2ab',
  state: 'queued',
  origin: 'backlog',
  attempts: 0,
  maxAttempts: 2,
  usage: { usd: 0.25, tokensIn: 1200, tokensOut: 300 },
  contextTokens: 1500,
  contextEpoch: 1,
  reviewedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const proposal = {
  branch: 'cb/design-edit',
  sha: '9f1c2ab',
  paths: ['design/tokens/core.json'],
  createdAt: NOW,
};

const session = {
  id: SESSION_ID,
  repoId: REPO_ID,
  target: 'work',
  workId: WORK_ID,
  title: 'Decide the gate',
  status: 'idle',
  branch: 'cb/work-01J-decision',
  pendingProposal: proposal,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  createdAt: NOW,
  updatedAt: NOW,
  lastMessage: null,
};

const repoSchedule = {
  id: 'sch_01JABCDEFG',
  repoId: REPO_ID,
  mode: 'every',
  cron: '0 3 * * *',
  timezone: 'Europe/Madrid',
  windowStart: null,
  windowEnd: null,
  cooldownMinutes: 20,
  selection: 'nextPending',
  refs: [],
  maxAttempts: 2,
  maxFires: 6,
  maxCostPerFireUsd: 0.75,
  consecutiveFailures: 0,
  firesCount: 3,
  spendUsd: 1.25,
  enabled: true,
  nextFireAt: '2026-10-29T02:00:00Z',
  lastFiredAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function refusal(input: unknown, schema: { safeParse: (value: unknown) => { success: boolean } }) {
  return schema.safeParse(input).success;
}

function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }
  return null;
}

describe('backlog', () => {
  const backlog = {
    repoId: REPO_ID,
    revision: '9f1c2ab',
    path: 'TODO.md',
    sections: [
      {
        title: 'Batch 15 — Agent pipeline hygiene',
        items: [
          {
            ref: 'Task-35',
            title: 'Routine engine',
            checked: false,
            line: 512,
            needs: ['Task-34'],
            work: { id: WORK_ID, state: 'merged', runs: 2 },
          },
          {
            ref: 'Task-36',
            title: 'Session replay',
            checked: false,
            line: 520,
            needs: [],
            work: null,
          },
        ],
      },
    ],
  };

  it('round-trips the parsed backlog and its work join', () => {
    expect(parseBacklog(backlog)).toEqual(backlog);
    expect(backlogSchema.safeParse(backlog).success).toBe(true);
    const first = backlogSchema.parse(backlog).sections[0]?.items[0];
    expect(first?.work?.runs).toBe(2);
    expect(first?.needs).toEqual(['Task-34']);
  });

  it('defaults a payload without needs to an empty list and accepts a Task-NN', () => {
    const legacy = {
      repoId: REPO_ID,
      revision: '9f1c2ab',
      path: 'TODO.md',
      sections: [
        {
          title: 'Batch 15',
          items: [{ ref: 'Task-35', title: 'Routine engine', checked: false, line: 512, work: null }],
        },
      ],
    };
    const withNeeds = {
      ...legacy,
      sections: [
        {
          title: 'Batch 15',
          items: [
            {
              ref: 'Task-35',
              title: 'Routine engine',
              checked: false,
              line: 512,
              needs: ['Task-34', 'Task-38'],
              work: null,
            },
          ],
        },
      ],
    };

    expect(backlogSchema.parse(legacy).sections[0]?.items[0]?.needs).toEqual([]);
    expect(backlogSchema.parse(withNeeds).sections[0]?.items[0]?.needs).toEqual([
      'Task-34',
      'Task-38',
    ]);
  });

  it('refuses a null, a string, a bad ref and an unknown key on needs', () => {
    const withNeeds = (needs: unknown): unknown => ({
      repoId: REPO_ID,
      revision: '9f1c2ab',
      path: 'TODO.md',
      sections: [
        {
          title: 'Batch 15',
          items: [
            { ref: 'Task-35', title: 'Routine engine', checked: false, line: 512, needs, work: null },
          ],
        },
      ],
    });

    expect(refusal(withNeeds(['Task-34']), backlogSchema)).toBe(true);
    expect(refusal(withNeeds(null), backlogSchema)).toBe(false);
    expect(refusal(withNeeds('Task-34'), backlogSchema)).toBe(false);
    expect(refusal(withNeeds(['task-34']), backlogSchema)).toBe(false);
    expect(refusal(withNeeds([{ ref: 'Task-34' }]), backlogSchema)).toBe(false);
    expect(
      refusal(
        {
          repoId: REPO_ID,
          revision: '9f1c2ab',
          path: 'TODO.md',
          sections: [
            {
              title: 'Batch 15',
              items: [
                {
                  ref: 'Task-35',
                  title: 'Routine engine',
                  checked: false,
                  line: 512,
                  needs: [],
                  dependencies: ['Task-34'],
                  work: null,
                },
              ],
            },
          ],
        },
        backlogSchema,
      ),
    ).toBe(false);
  });

  it('refuses an unknown key, a bad ref and a non-positive line', () => {
    expect(refusal({ ...backlog, extra: true }, backlogSchema)).toBe(false);
    const badRef = {
      ...backlog,
      sections: [
        {
          title: 'Batch',
          items: [{ ref: 'task-35', title: 'x', checked: false, line: 1, work: null }],
        },
      ],
    };
    expect(refusal(badRef, backlogSchema)).toBe(false);
    const zeroLine = {
      ...backlog,
      sections: [
        {
          title: 'Batch',
          items: [{ ref: 'Task-35', title: 'x', checked: false, line: 0, work: null }],
        },
      ],
    };
    expect(refusal(zeroLine, backlogSchema)).toBe(false);
  });
});

describe('work', () => {
  it('round-trips a work and its detail', () => {
    expect(parseWork(work)).toEqual(work);
    expect(workSchema.safeParse(work).success).toBe(true);
    expect(parseWorkDetail({ work, repo: REPO, runs: [] })).toEqual({
      work,
      repo: REPO,
      runs: [],
    });
    expect(workDetailSchema.safeParse({ work, repo: REPO, runs: [] }).success).toBe(true);
  });

  it('refuses a negative attempt count', () => {
    expect(refusal({ ...work, attempts: -1 }, workSchema)).toBe(false);
    expect(refusal({ ...work, maxAttempts: 0 }, workSchema)).toBe(false);
    expect(refusal({ ...work, state: 'done' }, workSchema)).toBe(false);
    expect(refusal({ ...work, origin: 'chat' }, workSchema)).toBe(false);
    expect(refusal({ ...work, backlogRef: 'Task-35a' }, workSchema)).toBe(false);
    expect(refusal({ ...work, extra: 'x' }, workSchema)).toBe(false);
  });

  it('names the work boundary when a field fails', () => {
    const error = errorOf(() => parseWork({ ...work, specSha: 'not-a-sha' }));
    expect(error).toBeInstanceOf(ContractParseError);
    expect(error instanceof ContractParseError ? error.boundary : null).toBe('work');
    expect(error instanceof ContractParseError ? error.first.path : null).toBe('work.specSha');
  });
});

describe('session', () => {
  it('round-trips a work session with its proposal and its last message', () => {
    const message = {
      id: 'msg_01JABCDEFG',
      sessionId: SESSION_ID,
      role: 'assistant',
      text: 'The gate is ambiguous.',
      createdAt: NOW,
    };
    expect(parseSession(session)).toEqual(session);
    expect(parseSession({ ...session, lastMessage: message }).lastMessage).toEqual(message);
    expect(parseSessionMessage(message)).toEqual(message);
    expect(sessionMessageSchema.safeParse(message).success).toBe(true);
    expect(sessionProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it('keeps a read-only repo session free of a branch and a proposal', () => {
    const readOnly = {
      ...session,
      target: 'repo',
      workId: null,
      branch: null,
      pendingProposal: null,
    };
    expect(sessionSchema.safeParse(readOnly).success).toBe(true);
    expect(refusal({ ...readOnly, branch: 'cb/read' }, sessionSchema)).toBe(false);
    expect(refusal({ ...readOnly, pendingProposal: proposal }, sessionSchema)).toBe(false);
  });

  it('needs a work exactly when the target is work', () => {
    expect(refusal({ ...session, target: 'work', workId: null }, sessionSchema)).toBe(false);
    expect(refusal({ ...session, target: 'backlog', workId: WORK_ID }, sessionSchema)).toBe(false);
    const backlogSession = {
      ...session,
      target: 'backlog',
      workId: null,
      branch: null,
      pendingProposal: null,
    };
    expect(sessionSchema.safeParse(backlogSession).success).toBe(true);
  });

  it('refuses a proposal without paths and an archived-status typo', () => {
    expect(refusal({ ...proposal, paths: [] }, sessionProposalSchema)).toBe(false);
    expect(refusal({ ...session, status: 'closed' }, sessionSchema)).toBe(false);
    expect(refusal({ ...session, target: 'code' }, sessionSchema)).toBe(false);
  });
});

describe('repository schedule', () => {
  it('round-trips every mode', () => {
    expect(parseRepoSchedule(repoSchedule)).toEqual(repoSchedule);
    const window = {
      ...repoSchedule,
      mode: 'window',
      cron: null,
      windowStart: '22:00',
      windowEnd: '06:00',
    };
    expect(repoScheduleSchema.safeParse(window).success).toBe(true);
    const refs = { ...repoSchedule, selection: 'refs', refs: ['Task-35', 'Task-36'] };
    expect(repoScheduleSchema.safeParse(refs).success).toBe(true);
  });

  it('refuses refs selection without refs and nextPending with refs', () => {
    expect(refusal({ ...repoSchedule, selection: 'refs', refs: [] }, repoScheduleSchema)).toBe(
      false,
    );
    expect(
      refusal({ ...repoSchedule, selection: 'nextPending', refs: ['Task-35'] }, repoScheduleSchema),
    ).toBe(false);
  });

  it('refuses a window schedule that carries a cron', () => {
    const window = {
      ...repoSchedule,
      mode: 'window',
      cron: '0 3 * * *',
      windowStart: '22:00',
      windowEnd: '06:00',
    };
    expect(refusal(window, repoScheduleSchema)).toBe(false);
    expect(refusal({ ...repoSchedule, cron: null }, repoScheduleSchema)).toBe(false);
    expect(
      refusal(
        { ...repoSchedule, mode: 'window', cron: null, windowStart: '22:00', windowEnd: '22:00' },
        repoScheduleSchema,
      ),
    ).toBe(false);
  });

  it('has no title, no prompt and no chat', () => {
    expect(refusal({ ...repoSchedule, title: 'Nightly' }, repoScheduleSchema)).toBe(false);
    expect(refusal({ ...repoSchedule, prompt: 'Pick one' }, repoScheduleSchema)).toBe(false);
    expect(refusal({ ...repoSchedule, chatSessionId: 'chat_01JABCDEFG' }, repoScheduleSchema)).toBe(
      false,
    );
  });

  it('names the repoSchedule boundary when a field fails', () => {
    const error = errorOf(() => parseRepoSchedule({ ...repoSchedule, maxAttempts: 0 }));
    expect(error).toBeInstanceOf(ContractParseError);
    expect(error instanceof ContractParseError ? error.boundary : null).toBe('repoSchedule');
  });
});
