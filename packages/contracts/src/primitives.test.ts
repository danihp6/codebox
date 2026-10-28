import { describe, expect, it } from 'vitest';
import {
  ApprovalId,
  ChatId,
  Cursor,
  DeviceId,
  ID_PREFIXES,
  JobId,
  MessageId,
  ProviderAccountId,
  ROUTINE_EVENT_NAMES,
  ROUTINE_KINDS,
  RepoId,
  RequestId,
  RoutineId,
  RUN_MODES,
  RUN_STATE_TERMINAL,
  RUN_STATES,
  RUN_TRIGGERS,
  RunId,
  SELECTIONS,
  SESSION_STATUSES,
  SESSION_TARGETS,
  ScheduleId,
  SessionId,
  SCOPES,
  SSE_CONTROL_EVENT_NAMES,
  SSE_EVENT_NAMES,
  SubscriptionId,
  WORK_ORIGINS,
  WORK_STATE_IN_FLIGHT,
  WORK_STATES,
  WorkId,
  backlogRefSchema,
  branchSchema,
  commitShaSchema,
  cronSchema,
  globSchema,
  idSchema,
  isTerminalRunState,
  routineKindSchema,
  runStateSchema,
  selectionSchema,
  sessionStatusSchema,
  sessionTargetSchema,
  sseEventNameSchema,
  slugSchema,
  timestampSchema,
  timezoneSchema,
  workOriginSchema,
  workStateSchema,
} from './primitives.js';
import type { RunState, WorkState } from './primitives.js';

describe('ids', () => {
  it('accepts one prefix per resource and rejects a foreign prefix', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['repo_01JABCDEFG', 'repo'],
      ['job_01JABCDEFG', 'job'],
      ['run_01JABCDEFG', 'run'],
      ['apv_01JABCDEFG', 'approval'],
      ['chat_01JABCDEFG', 'chat'],
      ['msg_01JABCDEFG', 'message'],
      ['dev_01JABCDEFG', 'device'],
      ['sub_01JABCDEFG', 'pushSubscription'],
      ['rtn_01JABCDEFG', 'routine'],
      ['sch_01JABCDEFG', 'schedule'],
      ['wrk_01JABCDEFG', 'work'],
      ['sess_01JABCDEFG', 'session'],
      ['acct_01JABCDEFG', 'providerAccount'],
      ['c_01JABCDEFG', 'cursor'],
      ['req_01JABCDEFG', 'request'],
    ];
    for (const [id, prefix] of cases) {
      expect(idSchema(prefix as keyof typeof ID_PREFIXES).safeParse(id).success).toBe(true);
    }
    expect(ID_PREFIXES.routine).toBe('rtn_');
    expect(ID_PREFIXES.schedule).toBe('sch_');
    expect(ID_PREFIXES.work).toBe('wrk_');
    expect(ID_PREFIXES.session).toBe('sess_');
    expect(ID_PREFIXES.providerAccount).toBe('acct_');
    expect(RepoId.safeParse('run_01JABCDEFG').success).toBe(false);
    expect(JobId.safeParse('job_short').success).toBe(false);
    expect(RunId.safeParse('run_01JABCDEFG').success).toBe(true);
    expect(ApprovalId.safeParse('apv_01JABCDEFG').success).toBe(true);
    expect(ChatId.safeParse('chat_01JABCDEFG').success).toBe(true);
    expect(MessageId.safeParse('msg_01JABCDEFG').success).toBe(true);
    expect(DeviceId.safeParse('dev_01JABCDEFG').success).toBe(true);
    expect(SubscriptionId.safeParse('sub_01JABCDEFG').success).toBe(true);
    expect(RoutineId.safeParse('rtn_01JABCDEFG').success).toBe(true);
    expect(RoutineId.safeParse('sub_01JABCDEFG').success).toBe(false);
    expect(RoutineId.safeParse('rtn_short').success).toBe(false);
    expect(ScheduleId.safeParse('sch_01JABCDEFG').success).toBe(true);
    expect(ScheduleId.safeParse('rtn_01JABCDEFG').success).toBe(false);
    expect(WorkId.safeParse('wrk_01JABCDEFG').success).toBe(true);
    expect(WorkId.safeParse('sess_01JABCDEFG').success).toBe(false);
    expect(SessionId.safeParse('sess_01JABCDEFG').success).toBe(true);
    expect(ProviderAccountId.safeParse('acct_01JABCDEFG').success).toBe(true);
    expect(ProviderAccountId.safeParse('wrk_01JABCDEFG').success).toBe(false);
    expect(Cursor.safeParse('c_01JABCDEFG').success).toBe(true);
    expect(RequestId.safeParse('req_01JABCDEFG').success).toBe(true);
  });

  it('accepts a backlog ref and nothing else', () => {
    expect(backlogRefSchema.safeParse('Task-35').success).toBe(true);
    expect(backlogRefSchema.safeParse('Task-0').success).toBe(true);
    expect(backlogRefSchema.safeParse('task-35').success).toBe(false);
    expect(backlogRefSchema.safeParse('Task-').success).toBe(false);
    expect(backlogRefSchema.safeParse('Task-35a').success).toBe(false);
    expect(backlogRefSchema.safeParse(' wrk_35').success).toBe(false);
  });
});

describe('scalars', () => {
  it('accepts only RFC 3339 UTC with a Z suffix', () => {
    expect(timestampSchema.safeParse('2026-10-24T18:03:11Z').success).toBe(true);
    expect(timestampSchema.safeParse('2026-10-24T18:03:11+02:00').success).toBe(false);
    expect(timestampSchema.safeParse('2026-10-24T18:03:11').success).toBe(false);
    expect(timestampSchema.safeParse('2026-10-24').success).toBe(false);
  });

  it('accepts a five-field cron and nothing else', () => {
    expect(cronSchema.safeParse('0 3 * * *').success).toBe(true);
    expect(cronSchema.safeParse('*/15 0-6 1,15 * 1-5').success).toBe(true);
    expect(cronSchema.safeParse('0 3 * *').success).toBe(false);
    expect(cronSchema.safeParse('0 3 * * * *').success).toBe(false);
    expect(cronSchema.safeParse('').success).toBe(false);
  });

  it('checks the timezone shape and leaves IANA existence to core', () => {
    expect(timezoneSchema.safeParse('Europe/Madrid').success).toBe(true);
    expect(timezoneSchema.safeParse('UTC').success).toBe(true);
    expect(timezoneSchema.safeParse('America/Argentina/Buenos_Aires').success).toBe(true);
    expect(timezoneSchema.safeParse('Not/AZone9').success).toBe(true);
    expect(timezoneSchema.safeParse('Europe').success).toBe(false);
    expect(timezoneSchema.safeParse('Europe/Madrid ').success).toBe(false);
  });

  it('rejects a branch with whitespace or a double dot', () => {
    expect(branchSchema.safeParse('main').success).toBe(true);
    expect(branchSchema.safeParse('cb/run_01J-nightly-lockfile').success).toBe(true);
    expect(branchSchema.safeParse('feature/..main').success).toBe(false);
    expect(branchSchema.safeParse('two words').success).toBe(false);
    expect(branchSchema.safeParse('').success).toBe(false);
  });

  it('accepts owner/name slugs and rejects a bare name', () => {
    expect(slugSchema.safeParse('dani/example').success).toBe(true);
    expect(slugSchema.safeParse('dani/example.js').success).toBe(true);
    expect(slugSchema.safeParse('example').success).toBe(false);
    expect(slugSchema.safeParse('dani/').success).toBe(false);
    expect(commitShaSchema.safeParse('a1b2c3d').success).toBe(true);
    expect(commitShaSchema.safeParse('A1B2C3D').success).toBe(false);
    expect(commitShaSchema.safeParse('a1b2c3').success).toBe(false);
    expect(globSchema.safeParse('ops/**').success).toBe(true);
    expect(globSchema.safeParse('').success).toBe(false);
  });
});

describe('enums', () => {
  it('freezes the D14 run states in order and the terminal subset', () => {
    expect([...RUN_STATES]).toEqual([
      'queued',
      'preparing',
      'running',
      'gating',
      'pr_open',
      'merging',
      'succeeded',
      'failed',
      'cancelled',
    ]);
    expect([...RUN_STATE_TERMINAL]).toEqual(['succeeded', 'failed', 'cancelled']);
    for (const state of RUN_STATES) {
      expect(isTerminalRunState(state)).toBe(RUN_STATE_TERMINAL.includes(state));
    }
    expect(runStateSchema.safeParse('promoted').success).toBe(false);
    const states: RunState[] = ['queued', 'gating'];
    expect(states).toHaveLength(2);
  });

  it('freezes the scope, trigger and mode vocabularies', () => {
    expect([...SCOPES]).toEqual(['read', 'chat', 'runs', 'write', 'admin']);
    expect([...RUN_TRIGGERS]).toEqual(['schedule', 'manual', 'promote', 'revert', 'retry']);
    expect([...RUN_MODES]).toEqual(['work']);
    expect([...ROUTINE_KINDS]).toEqual(['prompt', 'reminder']);
    expect(routineKindSchema.safeParse('reminder').success).toBe(true);
    expect(routineKindSchema.safeParse('job').success).toBe(false);
  });

  it('freezes the work, session and selection vocabularies', () => {
    expect([...WORK_STATES]).toEqual([
      'queued',
      'running',
      'review',
      'merged',
      'failed',
      'needs_decision',
      'abandoned',
    ]);
    expect([...WORK_STATE_IN_FLIGHT]).toEqual(['queued', 'running', 'needs_decision']);
    expect([...WORK_ORIGINS]).toEqual(['manual', 'backlog', 'schedule']);
    expect([...SESSION_TARGETS]).toEqual(['backlog', 'design', 'schedule', 'work', 'repo']);
    expect([...SESSION_STATUSES]).toEqual(['idle', 'working', 'archived']);
    expect([...SELECTIONS]).toEqual(['nextPending', 'refs']);
    expect(workStateSchema.safeParse('merged').success).toBe(true);
    expect(workStateSchema.safeParse('done').success).toBe(false);
    expect(workOriginSchema.safeParse('schedule').success).toBe(true);
    expect(sessionTargetSchema.safeParse('work').success).toBe(true);
    expect(sessionTargetSchema.safeParse('code').success).toBe(false);
    expect(sessionStatusSchema.safeParse('archived').success).toBe(true);
    expect(selectionSchema.safeParse('refs').success).toBe(true);
    const states: WorkState[] = ['queued', 'merged'];
    expect(states).toHaveLength(2);
  });
});

describe('events', () => {
  it('the event name list is the D14 list', () => {
    expect(SSE_EVENT_NAMES).toHaveLength(38);
    expect([...SSE_EVENT_NAMES]).toEqual([
      'run.queued',
      'run.started',
      'run.output',
      'run.tool',
      'run.permission',
      'run.gate',
      'run.pr',
      'run.merged',
      'run.finished',
      'run.failed',
      'run.cancelled',
      'chat.delta',
      'chat.message',
      'chat.tool',
      'chat.permission',
      'chat.idle',
      'chat.compacted',
      'job.changed',
      'approval.created',
      'approval.resolved',
      'telemetry',
      'routine.fired',
      'routine.replied',
      'routine.failed',
      'work.created',
      'work.updated',
      'work.needs_decision',
      'work.closed',
      'session.created',
      'session.delta',
      'session.tool',
      'session.proposal',
      'session.closed',
      'schedule.fired',
      'schedule.skipped',
      'provider.state',
      'backlog.changed',
      'design.changed',
    ]);
    expect([...SSE_EVENT_NAMES].slice(21, 24)).toEqual([...ROUTINE_EVENT_NAMES]);
    expect([...SSE_EVENT_NAMES].slice(24)).toEqual([
      'work.created',
      'work.updated',
      'work.needs_decision',
      'work.closed',
      'session.created',
      'session.delta',
      'session.tool',
      'session.proposal',
      'session.closed',
      'schedule.fired',
      'schedule.skipped',
      'provider.state',
      'backlog.changed',
      'design.changed',
    ]);
    expect([...SSE_EVENT_NAMES].indexOf('chat.compacted')).toBe(16);
    expect([...SSE_EVENT_NAMES].indexOf('telemetry')).toBe(20);
    expect([...SSE_CONTROL_EVENT_NAMES]).toEqual(['gap']);
    for (const control of SSE_CONTROL_EVENT_NAMES) {
      expect((SSE_EVENT_NAMES as readonly string[]).includes(control)).toBe(false);
    }
    for (const name of SSE_EVENT_NAMES) {
      expect(sseEventNameSchema.safeParse(name).success).toBe(true);
    }
    expect(sseEventNameSchema.safeParse('gap').success).toBe(false);
  });
});
