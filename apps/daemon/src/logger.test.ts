import { describe, expect, it, vi } from 'vitest';
import { LOG_LEVELS, LOG_LEVEL_RANK, createLogger, formatLogLine, isLogLevel } from './logger.js';

function capture(): { readonly lines: string[]; readonly sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

function parseLine(line: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

describe('levels', () => {
  it('lists the five levels in rank order', () => {
    expect([...LOG_LEVELS]).toEqual(['trace', 'debug', 'info', 'warn', 'error']);
    expect(LOG_LEVEL_RANK).toEqual({ trace: 10, debug: 20, info: 30, warn: 40, error: 50 });
  });

  it('narrows a string with isLogLevel', () => {
    expect(isLogLevel('warn')).toBe(true);
    expect(isLogLevel('fatal')).toBe(false);
    expect(isLogLevel('')).toBe(false);
  });
});

describe('formatLogLine', () => {
  it('prepends ts and keeps level then msg first', () => {
    const now = new Date('2026-10-25T10:00:00.123Z');
    const line = formatLogLine({ level: 'warn', msg: 'hello', ts: 'ignored', port: 8787 }, now);
    expect(line).toBe('{"ts":"2026-10-25T10:00:00.123Z","level":"warn","msg":"hello","port":8787}');
    expect(line.endsWith('\n')).toBe(false);
  });

  it('falls back to an empty msg and the info level', () => {
    const now = new Date('2026-10-25T10:00:00.000Z');
    expect(JSON.parse(formatLogLine({}, now))).toEqual({
      ts: '2026-10-25T10:00:00.000Z',
      level: 'info',
      msg: '',
    });
  });
});

describe('createLogger', () => {
  it('writes one JSON line per record at or above the threshold', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: 'info', sink, base: { instance: 'cb-instance' } });
    logger.debug({ msg: 'skipped' });
    logger.info({ msg: 'kept' });
    logger.error({ msg: 'kept_too', code: 'X' });
    expect(lines).toHaveLength(2);
    expect(parseLine(lines[0] ?? '')).toEqual({
      ts: expect.any(String),
      level: 'info',
      msg: 'kept',
      instance: 'cb-instance',
    });
    expect(parseLine(lines[1] ?? '').code).toBe('X');
  });

  it('writes trace and debug at trace level and nothing below the threshold', () => {
    const { lines, sink } = capture();
    const trace = createLogger({ level: 'trace', sink });
    trace.trace({ msg: 'a' });
    trace.debug({ msg: 'b' });
    expect(lines).toHaveLength(2);
    const errorOnly = createLogger({ level: 'error', sink });
    errorOnly.warn({ msg: 'no' });
    errorOnly.info({ msg: 'no' });
    expect(lines).toHaveLength(2);
  });

  it('does not let base or fields override ts, level or msg', () => {
    const { lines, sink } = capture();
    const logger = createLogger({
      level: 'info',
      sink,
      base: { level: 'trace', ts: 'nope', msg: 'base', component: 'x' },
    });
    logger.child({ level: 'trace', msg: 'child' }).info({ msg: 'call', ts: 'nope' });
    const record = parseLine(lines[0] ?? '');
    expect(record.level).toBe('info');
    expect(record.msg).toBe('call');
    expect(typeof record.ts).toBe('string');
    expect(record.component).toBe('x');
    expect(Object.keys(record).slice(0, 3)).toEqual(['ts', 'level', 'msg']);
  });

  it('redacts every secret-shaped key in base, fields and children', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: 'info', sink, base: { instanceToken: 'base-value' } });
    logger.child({ childSecret: 'child-value' }).info({
      msg: 'request',
      authorization: 'Bearer value',
      nested: { password: 'hunter2', label: 'keep' },
    });
    const record = parseLine(lines[0] ?? '');
    expect(record.instanceToken).toBe('[redacted]');
    expect(record.childSecret).toBe('[redacted]');
    expect(record.authorization).toBe('[redacted]');
    expect(record.nested).toEqual({ password: '[redacted]', label: 'keep' });
    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).not.toContain('base-value');
  });

  it('serialises an Error under err without its stack by default', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: 'info', sink });
    logger.error({ msg: 'boom', err: new TypeError('bad thing') });
    const record = parseLine(lines[0] ?? '');
    expect(record.err).toEqual({ name: 'TypeError', message: 'bad thing' });
  });

  it('adds the stack when includeStack is set', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: 'info', sink, includeStack: true });
    logger.error({ msg: 'boom', error: new Error('bad thing') });
    const record = parseLine(lines[0] ?? '');
    expect(record.error).toMatchObject({ name: 'Error', message: 'bad thing' });
    expect(typeof (record.error as { stack?: unknown }).stack).toBe('string');
  });

  it('never throws on an unserialisable or circular value', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: 'info', sink });
    const circular: Record<string, unknown> = { msg: 'circular' };
    circular.self = circular;
    circular.fn = (): void => undefined;
    expect(() => logger.info(circular)).not.toThrow();
    const record = parseLine(lines[0] ?? '');
    expect(record.msg).toBe('circular');
    expect(record.fn).toBe('[unsupported]');
    expect(lines[0]).toContain('"[circular]"');
  });

  it('uses the injected clock for ts', () => {
    const { lines, sink } = capture();
    const fixed = new Date('2026-01-02T03:04:05.678Z');
    const logger = createLogger({ level: 'info', sink, now: () => fixed });
    logger.info({ msg: 'clocked' });
    expect(parseLine(lines[0] ?? '').ts).toBe('2026-01-02T03:04:05.678Z');
  });

  it('writes to process.stdout through the default sink', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      createLogger({ level: 'info' }).info({ msg: 'default_sink' });
      expect(String(write.mock.calls[0]?.[0])).toContain('"msg":"default_sink"');
      expect(String(write.mock.calls[0]?.[0]).endsWith('\n')).toBe(true);
    } finally {
      write.mockRestore();
    }
  });
});
