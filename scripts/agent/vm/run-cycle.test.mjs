import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const vmDir = path.join(repo, 'scripts', 'agent', 'vm');
const lib = path.join(vmDir, 'lib.sh');
const cycleScript = path.join(vmDir, 'run-cycle.sh');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const tempDirs = [];

function have(binary) {
  return spawnSync('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8' }).status === 0;
}

const ready = have('bash') && have('jq');

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function isolatedEnv(overrides) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CB_') || key.startsWith('OCI_')) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

function stub(bin, name, lines) {
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${lines.join('\n')}\n`);
  fs.chmodSync(path.join(bin, name), 0o755);
}

function makeBox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cycle-'));
  tempDirs.push(root);
  const state = path.join(root, 'state');
  const clone = path.join(root, 'clone');
  const bin = path.join(root, 'bin');

  fs.mkdirSync(path.join(state, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(state, 'cycles.ndjson'), '');
  fs.mkdirSync(path.join(clone, '.agent_specs'), { recursive: true });
  fs.writeFileSync(path.join(clone, 'TODO.md'), '- [ ] **[Task-1]** a stub task\n');
  fs.mkdirSync(bin, { recursive: true });

  stub(bin, 'git', [
    'args=("$@")',
    'if [ "${args[0]}" = "-C" ]; then args=("${args[@]:2}"); fi',
    'case "${args[0]}" in',
    '  status) : ;;',
    '  rev-parse)',
    '    case "${args[1]}" in',
    `      origin/main) printf "%s\\n" "${SHA_A}" ;;`,
    `      HEAD) printf "%s\\n" "${SHA_B}" ;;`,
    `      *) printf "%s\\n" "${SHA_B}" ;;`,
    '    esac ;;',
    '  log) printf "%s\\n" "dev: done task-101" ;;',
    '  remote) printf "%s\\n" "https://github.com/owner/repo.git" ;;',
    '  *) exit 0 ;;',
    'esac',
  ]);

  stub(bin, 'gh', ['if [ "$1" = "api" ]; then printf "%s\\n" "[]"; fi', 'exit 0']);

  stub(bin, 'node', [
    'case "$*" in',
    '  *verdict.mjs*) printf \'%s\\n\' \'{"status":"shipped","reason":"stub cycle","ok":true}\' ;;',
    '  *issue.mjs*) printf \'%s\\n\' "$*" >> "$NODE_LOG"; printf \'%s\\n\' \'{"action":"created","number":1,"url":"https://example.invalid/1","duplicates":[]}\' ;;',
    '  *) exit 0 ;;',
    'esac',
  ]);

  stub(bin, 'npm', ['exit 0']);
  stub(bin, 'flock', ['exit 0']);
  stub(bin, 'sleep', ['exit 0']);

  stub(bin, 'opencode', [
    'last=',
    'for arg in "$@"; do last=$arg; done',
    'printf "%s\\n" "$last" >> "$PROMPT_LOG"',
    'if [ -n "${OPENCODE_MARKER:-}" ]; then : > "$OPENCODE_MARKER"; fi',
    'exit 0',
  ]);

  stub(bin, 'df', [
    'printf "%s\\n" "Filesystem 1024-blocks Used Available Capacity Mounted on"',
    'printf "stub 1000000 0 %s 100%% /\\n" "${DF_AVAILABLE_KB:-2097152}"',
  ]);

  const env = isolatedEnv({
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    CB_AGENT_ENV: path.join(root, 'missing.env'),
    CB_AGENT_REPO: clone,
    CB_AGENT_STATE: state,
    CB_AGENT_MODEL: 'stub/model',
    CB_AGENT_GIT_TOKEN: 'stub',
    NODE_LOG: path.join(root, 'node.log'),
    PROMPT_LOG: path.join(root, 'prompt.log'),
    OPENCODE_MARKER: path.join(root, 'opencode.marker'),
    DF_AVAILABLE_KB: '2097152',
  });

  return { root, state, clone, bin, env };
}

function runCycle(box, args = [], extraEnv = {}) {
  return spawnSync('bash', [cycleScript, ...args], {
    env: { ...box.env, ...extraEnv },
    encoding: 'utf8',
  });
}

function expectOk(result) {
  if (result.status !== 0) {
    throw new Error(`run-cycle.sh exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

function ledgerValue(file, filter) {
  const result = spawnSync('bash', ['-c', `tail -1 "$LEDGER" | jq -r '${filter}'`], {
    env: { ...process.env, LEDGER: file },
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

describe.skipIf(!ready)('run-cycle.sh', () => {
  it('prune_logs removes a 15-day-old log and keeps the fresh one', () => {
    const box = makeBox();
    const logs = path.join(box.state, 'logs');
    const old = path.join(logs, 'cycle-2026-seed.log');
    const fresh = path.join(logs, 'cycle-today.log');
    fs.writeFileSync(old, 'seeded\n');
    fs.writeFileSync(fresh, 'fresh\n');
    const longAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, longAgo, longAgo);

    const result = spawnSync('bash', ['-c', '. "$LIB_SH"; prune_logs'], {
      env: { ...box.env, LIB_SH: lib },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(result.stdout).toContain('pruned 1 log(s) older than 14 day(s)');
  });

  it('refuses below 2 GB and never reaches the model', () => {
    const box = makeBox();

    const result = runCycle(box, ['--force'], { DF_AVAILABLE_KB: '1048576' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('2 GB');
    expect(fs.existsSync(box.env.PROMPT_LOG)).toBe(false);
    expect(fs.existsSync(box.env.OPENCODE_MARKER)).toBe(false);

    const calls = fs.readFileSync(box.env.NODE_LOG, 'utf8').trim().split('\n');
    const orders = calls.filter((line) => line.includes('scripts/agent/issue.mjs'));
    expect(orders).toHaveLength(1);
    expect(orders[0]).toContain('--label agent-blocked');
    expect(orders[0]).toContain('Autopilot refused: less than 2 GB free on the box');
  }, 20_000);

  it('--force is in the ledger, both ways', () => {
    const box = makeBox();
    const ledger = path.join(box.state, 'cycles.ndjson');

    expectOk(runCycle(box, ['--force'], { CB_AGENT_MAX_DEVS: '3' }));
    expect(ledgerValue(ledger, '.forced')).toBe('true');
    expect(ledgerValue(ledger, '.maxDevs')).toBe('3');

    expectOk(runCycle(box, [], { CB_AGENT_MAX_DEVS: '3' }));
    expect(ledgerValue(ledger, '.forced')).toBe('false');
    expect(ledgerValue(ledger, '.maxDevs')).toBe('3');
  }, 30_000);

  it('substitutes MAX_DEVS into the prompt and refuses 9', () => {
    const box = makeBox();

    expectOk(runCycle(box));

    const prompt = fs.readFileSync(box.env.PROMPT_LOG, 'utf8');
    expect(prompt).toContain('at most 2 devs');
    expect(prompt).not.toContain('{{MAX_DEVS}}');

    const template = fs.readFileSync(path.join(vmDir, 'prompt.md'), 'utf8');
    expect(template).toContain('{{MAX_DEVS}}');
    expect(template).toContain('4');

    const refused = runCycle(box, [], { CB_AGENT_MAX_DEVS: '9' });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('CB_AGENT_MAX_DEVS=9');
  }, 20_000);

  it.skipIf(!have('timeout'))('driver --force spends the bypass for exactly one pass', () => {
    const box = makeBox();
    const vmCopy = path.join(box.root, 'vm');
    fs.cpSync(vmDir, vmCopy, { recursive: true });
    fs.chmodSync(path.join(vmCopy, 'run-driver.sh'), 0o755);

    const cycleCalls = path.join(box.root, 'cycle-calls.log');
    const cycleStub = path.join(vmCopy, 'run-cycle.sh');
    fs.writeFileSync(cycleStub, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$CYCLE_LOG"\n');
    fs.chmodSync(cycleStub, 0o755);

    const gateDir = path.join(box.clone, 'scripts', 'agent');
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(
      path.join(gateDir, 'gate.mjs'),
      'process.stdout.write(JSON.stringify({ go: false, reason: "brake is \'off\'", alert: null }) + "\\n");\n',
    );

    fs.rmSync(path.join(box.bin, 'node'));

    const driverLog = path.join(box.root, 'driver.log');
    const result = spawnSync('timeout', ['3', path.join(vmCopy, 'run-driver.sh'), '--force'], {
      env: { ...box.env, CYCLE_LOG: cycleCalls, OPENCODE_API_KEY: 'stub' },
      encoding: 'utf8',
    });
    fs.writeFileSync(driverLog, `${result.stdout ?? ''}${result.stderr ?? ''}`);

    const printed = fs.readFileSync(driverLog, 'utf8');
    expect(printed).toContain('gate bypassed for one cycle (--force)');
    expect(printed).toContain("parked: brake is 'off'");
    expect(printed.indexOf("parked: brake is 'off'")).toBeGreaterThan(
      printed.indexOf('gate bypassed for one cycle (--force)'),
    );

    const calls = fs
      .readFileSync(cycleCalls, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    expect(calls).toHaveLength(1);
    expect(calls[0].endsWith('--force')).toBe(true);
  }, 30_000);
});
