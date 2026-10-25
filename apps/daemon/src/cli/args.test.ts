import { describe, expect, it } from 'vitest';
import { COMMAND_NAMES, UsageError, parseArgs } from './args.js';

function usageError(argv: readonly string[]): UsageError {
  try {
    parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) return error;
    throw error;
  }
  throw new Error(`parseArgs(${JSON.stringify(argv)}) did not throw`);
}

describe('arguments', () => {
  it('parses a command, its positional and its value flags', () => {
    const parsed = parseArgs(['run', 'job_ABC123', '--json', '--url', 'http://127.0.0.1:8787']);

    expect(parsed.command).toBe('run');
    expect(parsed.positionals).toEqual(['job_ABC123']);
    expect(parsed.flags).toEqual({ json: true, url: 'http://127.0.0.1:8787' });
  });

  it('accepts --flag=value and repeated value flags', () => {
    expect(parseArgs(['pair', '--name=Dani iPhone', '--ttl=300']).flags).toEqual({
      name: 'Dani iPhone',
      ttl: '300',
    });
  });

  it('keeps the positional before and after flags', () => {
    expect(parseArgs(['logs', '--json', 'run_ABC123']).positionals).toEqual(['run_ABC123']);
  });

  it('turns --help and -h into the help command', () => {
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['-h']).command).toBe('help');
    expect(parseArgs(['status', '--help']).command).toBe('help');
  });

  it('turns --version into the version command', () => {
    expect(parseArgs(['--version']).command).toBe('version');
  });

  it('rejects an empty argv', () => {
    const error = usageError([]);
    expect(error.message).toContain('missing command');
    expect(error.flag).toBeNull();
  });

  it('rejects an unknown command and names it', () => {
    const error = usageError(['bogus']);
    expect(error.message).toContain('bogus');
  });

  it('rejects an unknown flag and names it', () => {
    const error = usageError(['status', '--bogus']);
    expect(error.flag).toBe('--bogus');
    expect(error.message).toContain('--bogus');
    expect(usageError(['status', '-x']).flag).toBe('-x');
  });

  it('rejects a flag that the command does not accept', () => {
    const error = usageError(['status', '--name', 'x']);
    expect(error.flag).toBe('--name');
    expect(error.message).toContain('status');
  });

  it('rejects a value flag without a value', () => {
    expect(usageError(['status', '--url']).flag).toBe('--url');
    expect(usageError(['status', '--token', '--json']).flag).toBe('--token');
    expect(usageError(['pair', '--name=']).flag).toBe('--name');
  });

  it('rejects a boolean flag with a value', () => {
    expect(usageError(['doctor', '--json=yes']).flag).toBe('--json');
  });

  it('rejects a missing positional and names the argument', () => {
    const error = usageError(['logs']);
    expect(error.message).toContain('<runId>');
  });

  it('rejects an extra positional', () => {
    expect(usageError(['run', 'job_ABC123', 'extra']).flag).toBe('extra');
  });

  it('rejects --json where the command does not render JSON', () => {
    expect(usageError(['update', '--json']).flag).toBe('--json');
  });

  it('lists every documented command', () => {
    expect(COMMAND_NAMES).toEqual([
      'pair',
      'status',
      'doctor',
      'run',
      'jobs',
      'logs',
      'events',
      'brake',
      'update',
      'backup',
      'revert',
      'help',
      'version',
    ]);
  });
});
