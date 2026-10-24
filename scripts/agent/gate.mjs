#!/usr/bin/env node

// The driver's decision, as a pure function: given the brake, the armed window, the
// backlog and today's counts, may a cycle start? The VM owns the loop now, so this is
// the one place that decides, and `docs/agent-vm.md` explains the state it reads.
//
// The order is the workflow's order, and it is load-bearing: the brake is read before
// the window (a manual `off` parks even inside a range), the window before the backlog
// (a late wake-up cannot start a cycle past the end), and the red streak last, because
// it is the one guard a human clears by hand.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RED_LIMIT = 3;

/**
 * @param {object} input
 * @param {string} input.brake          contents of the brake file; only `on` starts
 * @param {number|null} input.windowFrom epoch seconds, or null when no range is armed
 * @param {number|null} input.windowUntil epoch seconds, or null
 * @param {number} input.now            epoch seconds
 * @param {number} input.openTasks      `- [ ]` items in TODO.md
 * @param {number} input.cyclesToday    cycles started since UTC midnight
 * @param {number} input.redToday       cycles that failed since UTC midnight
 * @param {number} [input.cap]          daily cap; 0 or unset means no cap
 */
export function decideGate({
  brake,
  windowFrom = null,
  windowUntil = null,
  now,
  openTasks,
  cyclesToday,
  redToday = 0,
  cap = 0,
}) {
  if (String(brake ?? '').trim() !== 'on') {
    return { go: false, reason: `brake is '${String(brake ?? '').trim() || 'unset'}'`, alert: null };
  }

  if (windowUntil !== null && windowUntil !== undefined && now >= windowUntil) {
    return { go: false, reason: `the window closed at ${iso(windowUntil)}`, alert: null };
  }
  if (windowFrom !== null && windowFrom !== undefined && now < windowFrom) {
    return { go: false, reason: `the window opens at ${iso(windowFrom)}`, alert: null };
  }

  if (!(openTasks > 0)) {
    return {
      go: false,
      reason: 'no open task left in TODO.md',
      alert: {
        label: 'agent-blocked',
        title: 'Autopilot: nothing left to take',
        body: 'No open `[ ]` task remains in TODO.md. The loop is parked until a human frees one or adds work.',
      },
    };
  }

  if (redToday >= RED_LIMIT) {
    return {
      go: false,
      reason: `${redToday} red cycles today (limit ${RED_LIMIT})`,
      alert: {
        label: 'agent-blocked',
        title: `Autopilot parked: ${redToday} red cycles today`,
        body: `The loop stopped itself after ${redToday} failed cycles on ${iso(now).slice(0, 10)}. Look at the last cycle logs, fix or free the task it was on, then reset the streak (\`brake.sh reset\`).`,
      },
    };
  }

  const limit = Number(cap) || 0;
  if (limit > 0 && cyclesToday >= limit) {
    return { go: false, reason: `daily cap reached (${cyclesToday}/${limit})`, alert: null };
  }

  return { go: true, reason: 'a cycle may start', alert: null };
}

function iso(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function readWindow(stateDir) {
  const file = join(stateDir, 'window');
  if (!existsSync(file)) return { from: null, until: null };
  const [from, until] = readFileSync(file, 'utf8').trim().split(/\s+/);
  return {
    from: from ? Number(from) : null,
    until: until ? Number(until) : null,
  };
}

export function readBrake(stateDir) {
  const file = join(stateDir, 'brake');
  if (!existsSync(file)) return 'unset';
  return readFileSync(file, 'utf8').trim() || 'unset';
}

function arg(argv, name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('gate.mjs')) {
  const argv = process.argv.slice(2);
  const state = arg(argv, 'state', '.');
  const window = readWindow(state);
  const decision = decideGate({
    brake: readBrake(state),
    windowFrom: window.from,
    windowUntil: window.until,
    now: Number(arg(argv, 'now', Math.floor(Date.now() / 1000))),
    openTasks: Number(arg(argv, 'open', 0)),
    cyclesToday: Number(arg(argv, 'cycles-today', 0)),
    redToday: Number(arg(argv, 'red-today', 0)),
    cap: Number(arg(argv, 'cap', 0)),
  });
  process.stdout.write(`${JSON.stringify(decision)}\n`);
}
