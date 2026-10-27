import { describe, expect, it } from 'vitest';
import {
  ROUTINE_TOOL_NAMES,
  SSE_EVENT_NAMES,
  idSchema,
  parseRoutine,
  routineSchema,
  timestampSchema,
} from './index.js';

describe('entry point', () => {
  it('re-exports the primitives through index.js', () => {
    expect(SSE_EVENT_NAMES).toHaveLength(24);
    expect(idSchema('run').safeParse('run_01JABCDEFG').success).toBe(true);
    expect(timestampSchema.safeParse('2026-10-24T18:03:11Z').success).toBe(true);
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
