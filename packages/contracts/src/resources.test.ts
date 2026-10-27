import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import {
  GUARDRAIL_IDS,
  blockerCodeSchema,
  chatMessageSchema,
  chatSessionSchema,
  guardrailIdSchema,
  jobSchema,
  parseApproval,
  parseBrake,
  parseChatMessage,
  parseChatSession,
  parseDevice,
  parseHealth,
  parseJob,
  parseMe,
  parseNotificationPreferences,
  parseProviders,
  parsePushSubscription,
  parseRepo,
  parseRepoDetail,
  parseRepoVerify,
  parseRun,
  parseRunDiff,
  parseSchedule,
  parseScheduleDetail,
  parseSettings,
  parseTelemetry,
  parseVersion,
  repoSchema,
  scheduleSchema,
} from './resources.js';

const ts = '2026-10-24T18:03:11Z';
const repoId = 'repo_01JABCDEFG';
const jobId = 'job_01JABCDEFG';
const runId = 'run_01JABCDEFG';
const chatId = 'chat_01JABCDEFG';
const approvalId = 'apv_01JABCDEFG';
const deviceId = 'dev_01JABCDEFG';
const subscriptionId = 'sub_01JABCDEFG';
const messageId = 'msg_01JABCDEFG';

const repo = {
  id: repoId,
  slug: 'dani/example',
  defaultBranch: 'main',
  gate: 'npm ci && npm test && npm run build',
  policy: 'auto',
  protectedPaths: ['.github/**', 'ops/**', 'infra/**', '**/*.env'],
  enabled: true,
  createdAt: ts,
};

const job = {
  id: jobId,
  repoId,
  title: 'Nightly lockfile',
  prompt: 'Update the lockfile, run the gate, fix what breaks.',
  mode: 'work',
  agent: 'build',
  model: null,
  cron: '0 3 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  policy: 'auto',
  createdAt: ts,
  nextFireAt: '2026-10-25T01:00:00Z',
};

const run = {
  id: runId,
  repoId,
  jobId,
  state: 'pr_open',
  trigger: 'schedule',
  branch: 'cb/run_01J-nightly-lockfile',
  baseRef: 'main',
  pr: { number: 42, url: 'https://github.com/dani/example/pull/42', mergeable: true },
  gate: { status: 'passed', exitCode: 0, durationMs: 184000 },
  guardrails: [
    { id: 'gate', state: 'pass' },
    { id: 'checks', state: 'pass' },
    { id: 'base', state: 'fail', reason: 'base_moved' },
  ],
  blockers: [{ code: 'base_moved', message: 'main moved during the run.' }],
  diff: { files: 6, added: 184, removed: 22 },
  cost: { usd: 0.42, tokensIn: 18200, tokensOut: 3100 },
  createdAt: ts,
  finishedAt: null,
};

const chatMessage = {
  id: messageId,
  chatId,
  role: 'assistant',
  text: 'The lockfile is updated.',
  createdAt: ts,
};

const chatSession = {
  id: chatId,
  repoId,
  title: 'Scratch',
  status: 'idle',
  createdAt: ts,
  updatedAt: ts,
  lastMessage: chatMessage,
};

const schedule = {
  id: 'sch_01JABCDEFG',
  repoId,
  chatSessionId: null,
  title: 'Nightly drain',
  prompt: 'Pick the next issue and open a PR.',
  mode: 'window',
  cron: null,
  timezone: 'Europe/Madrid',
  windowStart: '22:00',
  windowEnd: '06:00',
  cooldownMinutes: 20,
  maxFires: 12,
  maxCostPerFireUsd: 1.5,
  firePolicy: 'new_chat',
  consecutiveFailures: 0,
  firesCount: 3,
  spendUsd: 0.84,
  enabled: true,
  policy: 'auto',
  nextFireAt: '2026-10-25T21:20:00Z',
  lastFiredAt: '2026-10-25T21:00:00Z',
  createdAt: ts,
  updatedAt: ts,
};

const scheduleEvery = {
  ...schedule,
  mode: 'every',
  cron: '0 3 * * *',
  windowStart: null,
  windowEnd: null,
  maxFires: null,
  maxCostPerFireUsd: null,
};

const fixtures: ReadonlyArray<{
  name: string;
  fixture: Record<string, unknown>;
  parse: (input: unknown) => unknown;
}> = [
  { name: 'Repo', fixture: repo, parse: parseRepo },
  { name: 'RepoDetail', fixture: { ...repo, lastRun: run }, parse: parseRepoDetail },
  {
    name: 'RepoVerify',
    fixture: {
      ok: true,
      defaultBranch: 'main',
      canPush: true,
      checks: [{ name: 'contents', state: 'ok' }],
    },
    parse: parseRepoVerify,
  },
  { name: 'Job', fixture: job, parse: parseJob },
  { name: 'Schedule', fixture: schedule, parse: parseSchedule },
  {
    name: 'ScheduleDetail',
    fixture: { schedule: scheduleEvery, nextFires: ['2026-10-25T02:00:00Z'] },
    parse: parseScheduleDetail,
  },
  { name: 'Run', fixture: run, parse: parseRun },
  {
    name: 'RunDiff',
    fixture: {
      files: 1,
      added: 2,
      removed: 1,
      changedFiles: [{ path: 'src/a.ts', status: 'modified', added: 2, removed: 1 }],
    },
    parse: parseRunDiff,
  },
  {
    name: 'Approval',
    fixture: {
      id: approvalId,
      state: 'pending',
      tool: 'bash',
      title: 'Run npm test',
      runId,
      chatId: null,
      input: { command: 'npm test' },
      createdAt: ts,
      expiresAt: '2026-10-24T18:13:11Z',
      resolvedAt: null,
    },
    parse: parseApproval,
  },
  {
    name: 'ChatSession',
    fixture: chatSession,
    parse: parseChatSession,
  },
  { name: 'ChatMessage', fixture: chatMessage, parse: parseChatMessage },
  {
    name: 'Device',
    fixture: {
      id: deviceId,
      name: 'Dani iPhone',
      platform: 'ios',
      scopes: ['read', 'chat', 'runs', 'write', 'admin'],
      createdAt: ts,
      lastSeenAt: null,
    },
    parse: parseDevice,
  },
  {
    name: 'Health',
    fixture: {
      status: 'ok',
      db: 'ok',
      opencode: 'degraded',
      disk: { freeBytes: 73400320000, totalBytes: 107374182400, usedPercent: 31.6 },
      queue: { pending: 1, running: 0, maxConcurrency: 2 },
      version: '1.0.0',
    },
    parse: parseHealth,
  },
  {
    name: 'Version',
    fixture: { version: '1.0.0', commit: 'a1b2c3d', builtAt: ts, node: 'v24.21.0' },
    parse: parseVersion,
  },
  {
    name: 'Telemetry',
    fixture: {
      range: '24h',
      since: '2026-10-23T18:03:11Z',
      spendUsd: 4.2,
      runs: { total: 5, succeeded: 3, failed: 1, cancelled: 1 },
      disk: { freeBytes: 73400320000, totalBytes: 107374182400, usedPercent: 31.6 },
      queueDepth: 2,
    },
    parse: parseTelemetry,
  },
  {
    name: 'Providers',
    fixture: {
      providers: [
        {
          provider: 'github',
          configured: true,
          mode: 'app',
          lastOkAt: ts,
          fingerprint: '…a1b2',
        },
        { provider: 'push', configured: false, mode: 'none', lastOkAt: null, fingerprint: null },
      ],
    },
    parse: parseProviders,
  },
  {
    name: 'Settings',
    fixture: {
      automerge: true,
      mergeMethod: 'squash',
      maxConcurrency: 2,
      dailyCostUsd: 10,
      protectedPaths: ['.github/**', 'ops/**', 'infra/**', '**/*.env', 'CODEOWNERS', '.gitmodules'],
      diffMaxFiles: 40,
      diffMaxLines: 2000,
      timezone: 'Europe/Madrid',
      quietHours: '22:00-08:00',
    },
    parse: parseSettings,
  },
  {
    name: 'NotificationPreferences',
    fixture: {
      events: ['run.finished', 'run.failed', 'approval.created'],
      quietHours: '22:00-08:00',
    },
    parse: parseNotificationPreferences,
  },
  {
    name: 'PushSubscription',
    fixture: {
      id: subscriptionId,
      kind: 'web',
      endpoint: 'https://push.example.com/subscriptions/1',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    },
    parse: parsePushSubscription,
  },
  {
    name: 'Me',
    fixture: {
      device: {
        id: deviceId,
        name: 'Dani iPhone',
        platform: 'ios',
        scopes: ['read'],
        createdAt: ts,
        lastSeenAt: ts,
      },
      scopes: ['read', 'chat'],
      serverTime: ts,
    },
    parse: parseMe,
  },
  { name: 'Brake', fixture: { enabled: true }, parse: parseBrake },
];

const documentedResources = [
  'Repo',
  'RepoDetail',
  'RepoVerify',
  'Job',
  'Run',
  'RunDiff',
  'Approval',
  'ChatSession',
  'ChatMessage',
  'Device',
  'Health',
  'Version',
  'Telemetry',
  'Providers',
  'Settings',
  'NotificationPreferences',
  'PushSubscription',
  'Me',
  'Brake',
  'Schedule',
  'ScheduleDetail',
].sort();

function parseError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  return null;
}

describe('resources', () => {
  it('every resource fixture parses', () => {
    expect(fixtures.map((entry) => entry.name).sort()).toEqual(documentedResources);
    for (const { name, fixture, parse } of fixtures) {
      const parsed = parse(fixture);
      expect(parsed, name).toEqual(fixture);
      expect(Object.keys(parsed as Record<string, unknown>).sort(), name).toEqual(
        Object.keys(fixture).sort(),
      );
    }
  });

  it('invalid payload names the field path', () => {
    const badCron = parseError(() => parseJob({ ...job, cron: 'not a cron' }));
    expect(badCron).toBeInstanceOf(ContractParseError);
    expect(badCron instanceof ContractParseError ? badCron.first.path : null).toBe('job.cron');

    const extraKey = parseError(() => parseJob({ ...job, extra: 1 }));
    expect(extraKey).toBeInstanceOf(ContractParseError);
    expect(extraKey instanceof ContractParseError ? extraKey.first.path : null).toBe('job.extra');
  });

  it('every resource object rejects an unknown field', () => {
    for (const { name, fixture, parse } of fixtures) {
      const error = parseError(() => parse({ ...fixture, unexpected: true }));
      expect(error, name).toBeInstanceOf(ContractParseError);
      expect(error instanceof ContractParseError ? error.first.path : null, name).toBe(
        `${boundaryOf(name)}.unexpected`,
      );
    }
  });

  it('guardrail ids are exactly the D12 list and cannot drift', () => {
    expect([...GUARDRAIL_IDS]).toEqual([
      'gate',
      'checks',
      'base',
      'diff',
      'protected_paths',
      'labels',
      'policy',
      'automerger',
    ]);
    expect([...guardrailIdSchema.options]).toEqual([...GUARDRAIL_IDS]);
    expect(guardrailIdSchema.safeParse('local_gate').success).toBe(false);
    expect(blockerCodeSchema.options).toHaveLength(9);
  });

  it('run states and nested arrays keep their documented vocabulary', () => {
    const unknownState = parseError(() => parseRun({ ...run, state: 'promoted' }));
    expect(unknownState instanceof ContractParseError ? unknownState.first.path : null).toBe(
      'run.state',
    );
    const badGuardrail = parseError(() =>
      parseRun({ ...run, guardrails: [{ id: 'gate', state: 'maybe' }] }),
    );
    expect(badGuardrail instanceof ContractParseError ? badGuardrail.first.path : null).toBe(
      'run.guardrails.0.state',
    );
    const badBlocker = parseError(() =>
      parseRun({ ...run, blockers: [{ code: 'too_large', message: 'x' }] }),
    );
    expect(badBlocker instanceof ContractParseError ? badBlocker.first.path : null).toBe(
      'run.blockers.0.code',
    );
  });

  it('rejects a non-https pull request url and a non-integer diff stat', () => {
    const httpPr = parseError(() =>
      parseRun({ ...run, pr: { number: 1, url: 'http://example.com/pull/1', mergeable: true } }),
    );
    expect(httpPr).toBeInstanceOf(ContractParseError);
    const badStat = parseError(() =>
      parseRun({ ...run, diff: { files: 1.5, added: 1, removed: 0 } }),
    );
    expect(badStat instanceof ContractParseError ? badStat.first.path : null).toBe(
      'run.diff.files',
    );
  });

  it('rejects a job timezone without a zone and a quiet hour outside the clock', () => {
    const noZone = parseError(() => parseJob({ ...job, timezone: 'Europe' }));
    expect(noZone instanceof ContractParseError ? noZone.first.path : null).toBe('job.timezone');
    const badHours = parseError(() =>
      parseNotificationPreferences({ events: ['chat.idle'], quietHours: '25:00-08:00' }),
    );
    expect(badHours instanceof ContractParseError ? badHours.first.path : null).toBe(
      'notificationPreferences.quietHours',
    );
  });

  it('rejects an unknown event in notification preferences', () => {
    const error = parseError(() =>
      parseNotificationPreferences({ events: ['run.unknown'], quietHours: null }),
    );
    expect(error instanceof ContractParseError ? error.first.path : null).toBe(
      'notificationPreferences.events.0',
    );
  });

  it('accepts a window schedule and an every schedule, and rejects a mixed shape', () => {
    expect(parseSchedule(schedule)).toEqual(schedule);
    expect(parseSchedule(scheduleEvery)).toEqual(scheduleEvery);

    const windowWithCron = parseError(() => parseSchedule({ ...schedule, cron: '0 3 * * *' }));
    expect(windowWithCron instanceof ContractParseError ? windowWithCron.first.path : null).toBe(
      'schedule.mode',
    );
    const everyWithWindow = parseError(() =>
      parseSchedule({ ...scheduleEvery, windowStart: '22:00', windowEnd: '06:00' }),
    );
    expect(everyWithWindow instanceof ContractParseError ? everyWithWindow.first.path : null).toBe(
      'schedule.mode',
    );
    const emptyWindow = parseError(() => parseSchedule({ ...schedule, windowEnd: '22:00' }));
    expect(emptyWindow instanceof ContractParseError ? emptyWindow.first.path : null).toBe(
      'schedule.mode',
    );
    const missingCron = parseError(() => parseSchedule({ ...scheduleEvery, cron: null }));
    expect(missingCron instanceof ContractParseError ? missingCron.first.path : null).toBe(
      'schedule.mode',
    );
  });

  it('bounds a schedule window time, its id and its counters', () => {
    expect(scheduleSchema.safeParse({ ...schedule, windowStart: '24:00' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...schedule, id: 'rtn_01JABCDEFG' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...schedule, cooldownMinutes: -1 }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...schedule, maxFires: 0 }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...schedule, firePolicy: 'reuse' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...schedule, policy: 'sometimes' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...schedule, mode: 'daily' }).success).toBe(false);
  });

  it('keeps the repo schema strict for nested objects', () => {
    expect(repoSchema.safeParse(repo).success).toBe(true);
    expect(chatMessageSchema.safeParse({ ...chatMessage, role: 'tool' }).success).toBe(false);
    expect(jobSchema.safeParse({ ...job, model: 42 }).success).toBe(false);
  });

  it('accepts a free chat with a null repoId and demands the key', () => {
    const free = { ...chatSession, repoId: null };
    expect(parseChatSession(free)).toEqual(free);
    expect(chatSessionSchema.safeParse(free).success).toBe(true);
    expect(chatSessionSchema.safeParse({ ...chatSession, repoId: undefined }).success).toBe(false);
    expect(chatSessionSchema.safeParse({ ...chatSession, repoId: 'not-a-repo-id' }).success).toBe(
      false,
    );
  });
});

function boundaryOf(name: string): string {
  switch (name) {
    case 'Repo':
      return 'repo';
    case 'RepoDetail':
      return 'repoDetail';
    case 'RepoVerify':
      return 'repoVerify';
    case 'Job':
      return 'job';
    case 'Schedule':
      return 'schedule';
    case 'ScheduleDetail':
      return 'scheduleDetail';
    case 'Run':
      return 'run';
    case 'RunDiff':
      return 'runDiff';
    case 'Approval':
      return 'approval';
    case 'ChatSession':
      return 'chatSession';
    case 'ChatMessage':
      return 'chatMessage';
    case 'Device':
      return 'device';
    case 'Health':
      return 'health';
    case 'Version':
      return 'version';
    case 'Telemetry':
      return 'telemetry';
    case 'Providers':
      return 'providers';
    case 'Settings':
      return 'settings';
    case 'NotificationPreferences':
      return 'notificationPreferences';
    case 'PushSubscription':
      return 'pushSubscription';
    case 'Me':
      return 'me';
    case 'Brake':
      return 'brake';
    default:
      throw new Error(`unknown resource ${name}`);
  }
}
