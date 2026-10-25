export class UsageError extends Error {
  readonly flag: string | null;

  constructor(message: string, flag: string | null = null) {
    super(message);
    this.name = 'UsageError';
    this.flag = flag;
  }
}

export interface ParsedArgs {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

interface CommandSpec {
  readonly argument: string | null;
  readonly valueFlags: readonly string[];
  readonly booleanFlags: readonly string[];
  readonly allowsJson: boolean;
}

const COMMANDS: Readonly<Record<string, CommandSpec>> = Object.freeze({
  pair: { argument: null, valueFlags: ['name', 'ttl'], booleanFlags: [], allowsJson: true },
  status: { argument: null, valueFlags: [], booleanFlags: [], allowsJson: true },
  doctor: { argument: null, valueFlags: [], booleanFlags: [], allowsJson: true },
  run: { argument: '<jobId>', valueFlags: [], booleanFlags: [], allowsJson: true },
  jobs: { argument: null, valueFlags: ['pause', 'resume'], booleanFlags: [], allowsJson: true },
  logs: { argument: '<runId>', valueFlags: [], booleanFlags: [], allowsJson: true },
  events: { argument: '<runId>', valueFlags: [], booleanFlags: [], allowsJson: true },
  brake: { argument: 'on|off|status', valueFlags: [], booleanFlags: [], allowsJson: true },
  update: { argument: null, valueFlags: ['to'], booleanFlags: ['rollback'], allowsJson: false },
  backup: { argument: null, valueFlags: [], booleanFlags: ['verify'], allowsJson: false },
  revert: { argument: '<runId>', valueFlags: ['job'], booleanFlags: [], allowsJson: true },
  help: { argument: null, valueFlags: [], booleanFlags: [], allowsJson: false },
  version: { argument: null, valueFlags: [], booleanFlags: [], allowsJson: false },
});

export const COMMAND_NAMES: readonly string[] = Object.freeze(Object.keys(COMMANDS));

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  'url',
  'token',
  'name',
  'ttl',
  'pause',
  'resume',
  'to',
  'job',
]);
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'json',
  'rollback',
  'verify',
  'help',
  'version',
]);
const GLOBAL_BOOLEAN_FLAGS: readonly string[] = Object.freeze(['help', 'version']);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) throw new UsageError('missing command');

  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string | null = null;
  let index = 0;

  while (index < argv.length) {
    const token = argv[index];
    index += 1;
    if (token === undefined || token.length === 0) continue;

    if (token === '-h') {
      flags['help'] = true;
      continue;
    }

    if (token.startsWith('--')) {
      const separator = token.indexOf('=');
      const name = (separator === -1 ? token.slice(2) : token.slice(2, separator)).toLowerCase();
      const inline = separator === -1 ? null : token.slice(separator + 1);
      if (name.length === 0) throw new UsageError('empty flag', token);
      if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name)) {
        throw new UsageError(`unknown flag: ${token}`, token);
      }
      if (BOOLEAN_FLAGS.has(name)) {
        if (inline !== null) throw new UsageError(`flag --${name} takes no value`, `--${name}`);
        flags[name] = true;
        continue;
      }
      let value = inline;
      if (value === null) {
        const candidate = argv[index];
        if (candidate === undefined || candidate.startsWith('-')) {
          throw new UsageError(`flag --${name} needs a value`, `--${name}`);
        }
        value = candidate;
        index += 1;
      }
      if (value.length === 0) throw new UsageError(`flag --${name} needs a value`, `--${name}`);
      flags[name] = value;
      continue;
    }

    if (token.startsWith('-')) throw new UsageError(`unknown flag: ${token}`, token);

    if (command === null) command = token;
    else positionals.push(token);
  }

  if (flags['help'] === true) return { command: 'help', positionals: [], flags: {} };
  if (flags['version'] === true) return { command: 'version', positionals: [], flags: {} };
  if (command === null) throw new UsageError('missing command');

  const spec = COMMANDS[command];
  if (spec === undefined) throw new UsageError(`unknown command: ${command}`, null);

  const allowed: ReadonlySet<string> = new Set([
    'url',
    'token',
    ...GLOBAL_BOOLEAN_FLAGS,
    ...spec.valueFlags,
    ...spec.booleanFlags,
    ...(spec.allowsJson ? ['json'] : []),
  ]);
  for (const name of Object.keys(flags)) {
    if (!allowed.has(name))
      throw new UsageError(`unknown flag for ${command}: --${name}`, `--${name}`);
  }

  const wanted = spec.argument === null ? 0 : 1;
  if (positionals.length < wanted) {
    throw new UsageError(`missing argument for ${command}: ${spec.argument ?? ''}`.trimEnd());
  }
  if (positionals.length > wanted) {
    const extra = positionals[wanted] ?? '';
    throw new UsageError(`unexpected argument: ${extra}`, extra);
  }

  return { command, positionals, flags };
}
